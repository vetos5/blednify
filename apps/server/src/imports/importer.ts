/**
 * Playlist imports: a pasted link becomes a job that resolves the track list, fetches each track (directly for
 * SoundCloud/YouTube, matched on YouTube Music for Spotify), tags it with the original metadata + cover, and
 * indexes it like an upload. Jobs are persisted, run one at a time, and resume after a restart. The app turns a
 * job into a playlist with the same name and cover (playlists live on the phone).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeFileName, type PathClaimer } from "../claim";
import type { Config } from "../config";
import type { Db } from "../db";
import { toTrack, type Library, type Track } from "../library";
import type { Scanner } from "../scanner";
import { GOOD_MATCH, MIN_MATCH, score } from "./match";
import { available, errorLine, run } from "./proc";
import {
  artistsOf,
  LinkError,
  parseLink,
  resolveSpotify,
  resolveYtdlp,
  spotifyTrackCover,
  splitVideoTitle,
  titleForArtist,
  ytdlpJson,
  type Resolved,
  type ResolvedItem,
  type SourceKind,
  type YtInfo,
} from "./sources";

export { LinkError } from "./sources";

export type ImportState = "queued" | "resolving" | "running" | "done" | "failed" | "cancelled";
export type ImportItemState = "pending" | "downloading" | "done" | "failed";

export type ImportItem = {
  title: string;
  artist: string;
  state: ImportItemState;
  /** Set when done: the indexed server track. */
  track: Track | null;
  /** Done without downloading: the same original was imported before. */
  reused: boolean;
  error: string | null;
};

export type ImportJob = {
  id: string;
  url: string;
  source: SourceKind | null;
  state: ImportState;
  name: string | null;
  description: string | null;
  owner: string | null;
  /** Set by the admin on import: every song is tagged with this artist / album. */
  artist: string | null;
  album: string | null;
  hasCover: boolean;
  /** Human-readable caveat (e.g. Spotify's 100-track limit without API credentials). */
  warning: string | null;
  error: string | null;
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  items: ImportItem[];
};

type Stored = ImportJob & { plan?: ResolvedItem[] };

const IMPORT_DIR = "imports";
const AUDIO_FORMAT = "bestaudio[ext=m4a][format_id!*=preview]/bestaudio[acodec=mp3][format_id!*=preview]/bestaudio[format_id!*=preview]";
const COVER_MAX = 15 * 1024 * 1024;

export type ImporterDeps = { config: Config; db: Db; lib: Library; scanner: Scanner; claims: PathClaimer };

export class Importer {
  private readonly jobs = new Map<string, Stored>();
  private readonly queue: string[] = [];
  private current: { id: string; ctrl: AbortController } | null = null;
  private ready: Promise<boolean> | null = null;
  private readonly coverDir: string;
  private readonly workRoot: string;

  constructor(private readonly d: ImporterDeps) {
    this.coverDir = join(d.config.dataDir, "import-covers");
    // Work files live inside the music volume so the finished file can be hard-linked/renamed into place
    // (a rename across volumes fails). Dot-dirs are skipped by scans.
    this.workRoot = join(d.config.musicDir, IMPORT_DIR, ".work");
    const rows = d.db.sql.query<{ doc: string }, []>("SELECT doc FROM imports ORDER BY created_at").all();
    for (const r of rows) {
      const job = JSON.parse(r.doc) as Stored;
      job.artist ??= null;
      job.album ??= null;
      this.jobs.set(job.id, job);
    }
  }

  /** Resumes unfinished jobs (after a restart) and clears stale work files. */
  boot(): void {
    if (!this.d.config.imports.enabled) return;
    if (existsSync(this.workRoot)) {
      for (const e of readdirSync(this.workRoot)) void rm(join(this.workRoot, e), { recursive: true, force: true });
    }
    for (const job of this.jobs.values()) {
      if (job.state === "queued" || job.state === "resolving" || job.state === "running") {
        for (const it of job.items) if (it.state === "downloading") it.state = "pending";
        job.state = job.plan ? "running" : "queued";
        this.enqueue(job.id);
      }
    }
    this.startUpdater();
  }

  /** yt-dlp + ffmpeg are installed (cached; the Docker image ships them). */
  isAvailable(): Promise<boolean> {
    if (!this.d.config.imports.enabled) return Promise.resolve(false);
    this.ready ??= Promise.all([
      available(this.d.config.imports.ytdlp),
      available(this.d.config.imports.ffmpeg),
      available(this.d.config.imports.ffprobe),
    ]).then((r) => {
      const ok = r.every(Boolean);
      if (!ok) console.warn("[import] yt-dlp/ffmpeg/ffprobe not found: playlist imports are disabled");
      return ok;
    });
    return this.ready;
  }

  async start(url: string, opts: { artist?: string | null; album?: string | null } = {}): Promise<ImportJob> {
    await parseLink(url); // validates (throws LinkError)
    const now = new Date().toISOString();
    const job: Stored = {
      id: randomBytes(8).toString("hex"),
      url: url.trim(),
      source: null,
      state: "queued",
      name: null,
      description: null,
      owner: null,
      artist: opts.artist?.trim() || null,
      album: opts.album?.trim() || null,
      hasCover: false,
      warning: null,
      error: null,
      total: 0,
      done: 0,
      failed: 0,
      createdAt: now,
      updatedAt: now,
      items: [],
    };
    this.jobs.set(job.id, job);
    this.save(job);
    this.enqueue(job.id);
    return this.view(job);
  }

  get(id: string): ImportJob | null {
    const j = this.jobs.get(id);
    return j ? this.view(j) : null;
  }

  /** Newest first, without item lists. */
  list(): Omit<ImportJob, "items">[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map(({ items: _items, plan: _plan, ...rest }) => rest);
  }

  coverPath(id: string): string | null {
    const j = this.jobs.get(id);
    return j?.hasCover ? join(this.coverDir, `${id}.jpg`) : null;
  }

  cancel(id: string): ImportJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.state === "done" || job.state === "failed" || job.state === "cancelled") return this.view(job);
    job.state = "cancelled";
    for (const it of job.items) if (it.state === "pending" || it.state === "downloading") it.state = "failed", (it.error = "Cancelled");
    this.recount(job);
    this.save(job);
    if (this.current?.id === id) this.current.ctrl.abort();
    return this.view(job);
  }

  /** Re-runs failed tracks (or the whole job when resolving failed). */
  retry(id: string): ImportJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.state === "queued" || job.state === "resolving" || job.state === "running") return this.view(job);
    for (const it of job.items) if (it.state === "failed") (it.state = "pending"), (it.error = null);
    job.state = job.plan ? "running" : "queued";
    job.error = null;
    this.recount(job);
    this.save(job);
    this.enqueue(id);
    return this.view(job);
  }

  async remove(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.cancel(id);
    this.jobs.delete(id);
    this.d.db.sql.query("DELETE FROM imports WHERE id = ?").run(id);
    await rm(join(this.coverDir, `${id}.jpg`), { force: true });
    return true;
  }

  /** Resolves once the queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.current || this.queue.length) await Bun.sleep(20);
  }

  // ---------- internals ----------

  private view(j: Stored): ImportJob {
    const { plan: _plan, ...rest } = j;
    return structuredClone(rest);
  }

  private save(job: Stored): void {
    job.updatedAt = new Date().toISOString();
    this.d.db.sql
      .query("INSERT INTO imports (id, doc, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET doc = ?2")
      .run(job.id, JSON.stringify(job), job.createdAt);
  }

  private recount(job: Stored): void {
    job.done = job.items.filter((i) => i.state === "done").length;
    job.failed = job.items.filter((i) => i.state === "failed").length;
  }

  private enqueue(id: string): void {
    if (!this.queue.includes(id) && this.current?.id !== id) this.queue.push(id);
    void this.pump();
  }

  private pumping = false;
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let id = this.queue.shift(); id; id = this.queue.shift()) {
        const job = this.jobs.get(id);
        if (!job || job.state === "cancelled") continue;
        const ctrl = new AbortController();
        this.current = { id, ctrl };
        try {
          await this.runJob(job, ctrl.signal);
        } catch (err) {
          if (!isCancelled(job)) {
            job.state = "failed";
            job.error = err instanceof LinkError ? err.message : `Import failed: ${(err as Error).message}`;
            console.error(`[import] ${job.url}: ${(err as Error).message}`);
          }
          this.save(job);
        } finally {
          this.current = null;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runJob(job: Stored, signal: AbortSignal): Promise<void> {
    if (!(await this.isAvailable())) throw new LinkError("the server is missing yt-dlp/ffmpeg; use the Docker image");
    if (!job.plan) {
      job.state = "resolving";
      this.save(job);
      const link = await parseLink(job.url);
      const { imports } = this.d.config;
      const r: Resolved =
        link.kind === "spotify"
          ? await resolveSpotify(link, { id: imports.spotifyClientId, secret: imports.spotifyClientSecret })
          : await resolveYtdlp(link, imports.ytdlp);
      if (!r.items.length) throw new LinkError("found no songs at this link");
      if (signal.aborted) return;
      job.source = r.kind;
      job.name = r.name;
      job.description = r.description;
      job.owner = r.owner;
      job.warning = r.limited
        ? "Spotify's public page lists only the first 100 songs. Set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET on the server to import longer playlists."
        : null;
      job.plan = r.items;
      job.items = r.items.map((i) => ({
        title: (job.artist && i.title ? titleForArtist(i.title, job.artist) : i.title) || slugTitle(i.url) || "Unknown title",
        artist: job.artist ?? i.artists.join(", "),
        state: "pending",
        track: null,
        reused: false,
        error: null,
      }));
      job.total = job.items.length;
      const firstSpotify = r.items[0]?.spotifyId;
      if (!r.coverUrl && r.kind === "spotify" && firstSpotify && r.items.length === 1) r.coverUrl = await spotifyTrackCover(firstSpotify);
      if (r.coverUrl) job.hasCover = await this.saveCover(job.id, r.coverUrl);
      job.state = "running";
      this.save(job);
    }

    const plan = job.plan!;
    let next = 0;
    const worker = async () => {
      for (;;) {
        if (signal.aborted || job.state === "cancelled") return;
        const i = next++;
        if (i >= plan.length) return;
        const item = job.items[i]!;
        if (item.state !== "pending") continue;
        item.state = "downloading";
        this.save(job);
        try {
          const { track: fetched, reused } = await this.fetchItem(plan[i]!, job, signal, (title, artists) => {
            if (title) item.title = job.artist ? titleForArtist(title, job.artist) : title;
            if (artists.length) item.artist = job.artist ?? artists.join(", ");
            this.save(job);
          });
          // A song imported before keeps its file: the admin's artist/album apply as a server-side edit.
          const track = reused ? this.applyOverrides(fetched, job) : fetched;
          Object.assign(item, { state: "done", track, reused, error: null, title: track.title, artist: track.artist });
        } catch (err) {
          if (isCancelled(job)) return;
          item.state = "failed";
          item.error = (err as Error).message || "failed";
          console.warn(`[import] ${item.artist} - ${item.title}: ${item.error}`);
        }
        this.recount(job);
        this.save(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.d.config.imports.concurrency, plan.length) }, worker));
    if (job.state === "cancelled") return;
    this.recount(job);
    job.state = job.done === 0 && job.failed > 0 ? "failed" : "done";
    if (job.state === "failed") job.error = job.items.find((i) => i.error)?.error ?? "no song could be imported";
    this.save(job);
  }

  private async saveCover(id: string, url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > COVER_MAX) return false;
      mkdirSync(this.coverDir, { recursive: true });
      const raw = join(this.coverDir, `.${id}.src`);
      await writeFile(raw, buf);
      // Normalise to a square JPEG (YouTube thumbnails are 16:9, SoundCloud may be PNG/WebP).
      const demuxer = imageDemuxer(buf);
      if (!demuxer) {
        await rm(raw, { force: true });
        return false;
      }
      const r = await run([this.d.config.imports.ffmpeg, "-v", "error", "-y", "-f", demuxer, "-i", raw, "-vf", SQUARE, "-frames:v", "1", "-q:v", "2", join(this.coverDir, `${id}.jpg`)]);
      await rm(raw, { force: true });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  private applyOverrides(track: Track, job: Stored): Track {
    if (!job.artist && !job.album) return track;
    const patch: { title?: string; artist?: string; album?: string } = {};
    if (job.artist && track.artist !== job.artist) {
      patch.artist = job.artist;
      const title = titleForArtist(track.title, job.artist);
      if (title !== track.title) patch.title = title;
    }
    if (job.album && track.album !== job.album) patch.album = job.album;
    return Object.keys(patch).length ? this.d.lib.editTrack(track.id, patch) : track;
  }

  private knownTrack(source: string): Track | null {
    const row = this.d.db.sql.query<{ track_id: string }, [string]>("SELECT track_id FROM import_sources WHERE source = ?").get(source);
    const t = row ? this.d.lib.trackRow(row.track_id) : null;
    return t ? toTrack(t) : null;
  }

  private remember(sources: string[], trackId: string): void {
    const q = this.d.db.sql.query("INSERT OR REPLACE INTO import_sources (source, track_id) VALUES (?, ?)");
    for (const s of sources) q.run(s, trackId);
  }

  /** Downloads, tags and indexes one track, or returns the already-imported copy. */
  private async fetchItem(
    item: ResolvedItem,
    job: Stored,
    signal: AbortSignal,
    onMeta: (title: string, artists: string[]) => void,
  ): Promise<{ track: Track; reused: boolean }> {
    const known = this.knownTrack(item.source);
    if (known) return { track: known, reused: true };
    const ytdlp = this.d.config.imports.ytdlp;

    // 1. Find the audio: the link itself, or the best YouTube Music match.
    let info: YtInfo | null = null;
    const link = item.url;
    if (link) {
      let direct: YtInfo;
      try {
        direct = await ytdlpJson(ytdlp, ["--no-playlist", link], signal);
      } catch (err) {
        // Removed / geo-blocked upload: the same song may still be on YouTube Music.
        if (signal.aborted || !item.title) throw err;
        direct = { id: "", formats: [{ format_id: "preview" }] };
      }
      const audio = direct.formats?.filter((f) => f.vcodec === "none" || !f.vcodec) ?? [];
      // SoundCloud Go+ tracks only offer a 30 s preview to everyone else: look for the song on YouTube instead.
      if (audio.length && audio.every((f) => /preview/.test(f.format_id))) {
        const t = direct.track ?? direct.title ?? item.title;
        // The reported duration is the preview's, so the full length is unknown.
        item = { ...item, title: item.title || t, artists: item.artists.length ? item.artists : artistsOf(direct), durationMs: null };
      } else info = direct;
      if (info) {
        const parsed = !info.track ? splitVideoTitle(info.title ?? "") : null;
        const tagged = !!(info.artists?.length || info.artist);
        item = {
          ...item,
          title: info.track ?? parsed?.title ?? info.title ?? item.title,
          // Music metadata first; then "Artist - Title"; then what the playlist said; then the uploader.
          artists: tagged || info.track || !parsed?.artist ? (tagged ? artistsOf(info) : item.artists.length ? item.artists : artistsOf(info)) : [parsed.artist],
          album: item.album ?? info.album ?? null,
          year: item.year ?? info.release_year ?? null,
        };
      }
    }
    if (link) onMeta(item.title, item.artists);
    if (!info) {
      if (!item.title) throw new Error("song has no title to search for");
      info = await this.findOnYoutube(item, signal);
      const reuse = this.knownTrack(`youtube:${info.id}`);
      if (reuse) {
        this.remember([item.source], reuse.id);
        return { track: reuse, reused: true };
      }
    }
    if (signal.aborted) throw new Error("Cancelled");

    // 2. Download audio + thumbnail into a private work dir.
    const work = join(this.workRoot, randomUUID());
    await mkdir(work, { recursive: true });
    const final: string[] = [];
    try {
      const infoFile = join(work, "info.json");
      await writeFile(infoFile, JSON.stringify(info));
      const dl = await run(
        [ytdlp, "--load-info-json", infoFile, "-f", AUDIO_FORMAT, "-o", join(work, "audio.%(ext)s"), "--no-progress", "--no-warnings", "-q", "--write-thumbnail", "--convert-thumbnails", "jpg", ...ffmpegLocation(this.d.config.imports.ffmpeg)],
        { signal, timeoutMs: 15 * 60_000 },
      );
      if (signal.aborted) throw new Error("Cancelled");
      const files = readdirSync(work);
      const audio = files.find((f) => f.startsWith("audio.") && !/\.(jpg|webp|png|json|part)$/.test(f));
      if (dl.code !== 0 || !audio) throw new Error(errorLine(dl.stderr, "download failed"));

      // 3. Cover: the original's album art beats a video thumbnail.
      let coverUrl = item.coverUrl;
      if (!coverUrl && item.spotifyId) coverUrl = await spotifyTrackCover(item.spotifyId);
      let cover: string | null = null;
      if (coverUrl) {
        try {
          const res = await fetch(coverUrl, { signal: AbortSignal.timeout(15_000) });
          if (res.ok) {
            cover = join(work, "cover.img");
            await writeFile(cover, Buffer.from(await res.arrayBuffer()));
          }
        } catch {
          cover = null;
        }
      }
      if (!cover && files.includes("audio.jpg")) cover = join(work, "audio.jpg");
      const coverDemuxer = cover ? imageDemuxer(Buffer.from(await Bun.file(cover).slice(0, 16).arrayBuffer())) : null;
      if (!coverDemuxer) cover = null;

      // 4. Tag (and transcode only codecs the phone's MP4/MP3 path can't hold).
      const codec = await this.codecOf(join(work, audio));
      const ext = codec === "mp3" ? "mp3" : "m4a";
      const out = join(work, `out.${ext}`);
      const artists = job.artist ? [job.artist] : item.artists.length ? item.artists : artistsOf(info);
      const artist = artists.join(", ") || "Unknown Artist";
      const title = job.artist ? titleForArtist(item.title, job.artist) : item.title;
      // A SoundCloud song outside a set is a single: its album is its title.
      const album = job.album ?? item.album ?? info.album ?? (job.source === "soundcloud" ? title : null);
      const meta: Record<string, string | number | null | undefined> = {
        title,
        artist,
        album,
        album_artist: album ? (job.artist ?? item.albumArtist ?? artists[0] ?? artist) : null,
        date: item.year ?? info.release_year,
        track: item.trackNo,
        disc: item.discNo,
        genre: info.genre,
        comment: item.source.startsWith("spotify:") ? `${item.source} via youtube:${info.id}` : item.source,
      };
      await this.tag(join(work, audio), cover && coverDemuxer ? { path: cover, demuxer: coverDemuxer } : null, out, codec, meta, signal);

      // 5. Move into the library like an upload.
      const name = sanitizeFileName(`${artist} - ${title}.${ext}`);
      const dest = this.d.claims.claim(IMPORT_DIR, name);
      final.push(dest);
      const [track] = await this.d.scanner.indexUploads([{ tmp: out, final: dest }]);
      if (!track) throw new Error("indexing failed");
      this.remember([item.source, `youtube:${info.id}`, `${job.source ?? "x"}:${info.id}`].filter((s, i, a) => a.indexOf(s) === i), track.id);
      return { track, reused: false };
    } finally {
      for (const f of final) this.d.claims.release(f);
      await rm(work, { recursive: true, force: true });
    }
  }

  private async findOnYoutube(item: ResolvedItem, signal: AbortSignal): Promise<YtInfo> {
    const ytdlp = this.d.config.imports.ytdlp;
    const want = { title: item.title, artists: item.artists, durationMs: item.durationMs };
    const q = `${item.artists.slice(0, 2).join(" ")} ${item.title}`.trim();
    let best: { info: YtInfo; s: number } | null = null;
    const consider = async (urls: string[]) => {
      for (const url of urls) {
        if (signal.aborted) return;
        let info: YtInfo;
        try {
          info = await ytdlpJson(ytdlp, ["--no-playlist", url], signal);
        } catch {
          continue;
        }
        const s = score(want, { title: info.track ?? info.title ?? "", artists: artistsOf(info), durationSec: info.duration ?? null });
        if (!best || s > best.s) best = { info, s };
        if (s >= GOOD_MATCH) return;
      }
    };
    const pre = (entries: (YtInfo | null)[] | undefined, n: number) =>
      (entries ?? [])
        .filter((e): e is YtInfo => !!e?.id)
        .map((e, rank) => ({
          url: e.url && /^https?:/.test(e.url) ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
          // Flat search results carry the title (and on YouTube the duration/channel); keep search order on ties.
          s: score(want, { title: e.title ?? "", artists: artistsOf(e), durationSec: e.duration ?? null }) - rank * 0.01,
        }))
        .sort((a, b) => b.s - a.s)
        .slice(0, n)
        .map((e) => e.url);

    // YouTube Music "songs" are the official audio with album metadata.
    try {
      const music = await ytdlpJson(ytdlp, ["--flat-playlist", "--playlist-items", "1:8", `https://music.youtube.com/search?q=${encodeURIComponent(q)}#songs`], signal);
      await consider(pre(music.entries, 3));
    } catch {
      // fall through to plain YouTube
    }
    const found = best as { info: YtInfo; s: number } | null;
    if (!found || found.s < GOOD_MATCH) {
      try {
        const yt = await ytdlpJson(ytdlp, ["--flat-playlist", `ytsearch6:${q} audio`], signal);
        await consider(pre(yt.entries, 2));
      } catch {
        // keep what we have
      }
    }
    const pick = best as { info: YtInfo; s: number } | null;
    if (!pick || pick.s < MIN_MATCH) throw new Error("no matching song found on YouTube");
    return pick.info;
  }

  private async codecOf(path: string): Promise<string> {
    const r = await run([this.d.config.imports.ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", path]);
    return r.stdout.trim();
  }

  private async tag(
    input: string,
    cover: { path: string; demuxer: string } | null,
    out: string,
    codec: string,
    meta: Record<string, string | number | null | undefined>,
    signal: AbortSignal,
  ): Promise<void> {
    const ff = this.d.config.imports.ffmpeg;
    const base = (withCover: boolean) => {
      const a = ["-hide_banner", "-v", "error", "-y", "-i", input];
      if (withCover) a.push("-f", cover!.demuxer, "-i", cover!.path);
      a.push("-map", "0:a:0");
      if (withCover) a.push("-map", "1:v:0", "-c:v", "mjpeg", "-q:v", "2", "-vf", SQUARE, "-disposition:v:0", "attached_pic");
      if (codec === "mp3") a.push("-c:a", "copy", "-id3v2_version", "3", "-f", "mp3");
      else if (codec === "aac") a.push("-c:a", "copy", "-movflags", "+faststart", "-f", "mp4");
      else a.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4");
      a.push("-map_metadata", "-1");
      for (const [k, v] of Object.entries(meta)) if (v !== null && v !== undefined && v !== "") a.push("-metadata", `${k}=${v}`);
      a.push(out);
      return a;
    };
    let r = await run([ff, ...base(!!cover)], { signal, timeoutMs: 10 * 60_000 });
    // A broken cover image must not lose the song.
    if (r.code !== 0 && cover) r = await run([ff, ...base(false)], { signal, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) throw new Error(`could not tag the file: ${errorLine(r.stderr, "ffmpeg failed")}`);
  }

  /** YouTube breaks old yt-dlp releases often: upgrade at start and daily when the image allows it. */
  private startUpdater(): void {
    const pip = this.d.config.imports.ytdlpPip;
    if (!pip) return;
    const update = async () => {
      const r = await run([pip, "install", "-q", "-U", "--no-cache-dir", "yt-dlp[default,curl-cffi]"], { timeoutMs: 10 * 60_000 }).catch(
        (err: Error) => ({ code: -1, stdout: "", stderr: err.message }),
      );
      if (r.code !== 0) console.warn(`[import] yt-dlp update failed: ${errorLine(r.stderr, "pip failed")}`);
      this.ready = null;
    };
    setTimeout(() => void update(), 5_000).unref();
    setInterval(() => void update(), 24 * 3600_000).unref();
  }
}

/** "…/hinas-favorite-toy" → "hinas favorite toy": a placeholder until the real title is fetched. */
/**
 * The ffmpeg demuxer for an image, picked from its magic bytes, or null when it is not a known image format.
 * Covers come from third-party URLs: forcing the demuxer stops ffmpeg from probing them as a playlist format
 * (HLS, concat, ...) that could make it read other local files or URLs.
 */
export function imageDemuxer(head: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg_pipe";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "png_pipe";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp_pipe";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 2) === "BM") return "bmp_pipe";
  return null;
}

const slugTitle = (url: string | null) => {
  const seg = url ? decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "") : "";
  return seg && !/^watch$/i.test(seg) ? seg.replace(/[-_]+/g, " ").trim() : "";
};

/** yt-dlp takes a path, not a command name: only pass it for an explicit path. */
const ffmpegLocation = (ffmpeg: string) => (ffmpeg.includes("/") ? ["--ffmpeg-location", ffmpeg] : []);

/** Read through a function so TypeScript does not narrow away a state another call may have changed. */
const isCancelled = (job: { state: ImportState }) => job.state === "cancelled";

/** Center-crop to a square, at most 800 px. */
const SQUARE = "crop=min(iw\\,ih):min(iw\\,ih),scale=min(iw\\,800):-2";
