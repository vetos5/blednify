/**
 * Turns a pasted link into a playlist description: its name, cover and an ordered list of tracks to fetch.
 * Spotify has no downloadable audio: its tracks are matched on YouTube Music later. SoundCloud and YouTube
 * links are read with yt-dlp and downloaded directly.
 */
import { nameKey, similarity, skeleton, splitCredit, SUGGEST_MIN } from "../artists";
import { errorLine, run } from "./proc";

export type SourceKind = "spotify" | "soundcloud" | "youtube";

export type ParsedLink =
  | { kind: "spotify"; type: "playlist" | "album" | "track"; id: string }
  | { kind: "soundcloud" | "youtube"; url: string };

export type ResolvedItem = {
  title: string;
  artists: string[];
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
  durationMs: number | null;
  coverUrl: string | null;
  /** Stable identity of the original (`spotify:track:…`, `soundcloud:…`, `youtube:…`), used to reuse files. */
  source: string;
  /** Directly downloadable page; null = search YouTube Music for it. */
  url: string | null;
  /** Spotify track id (cover lookup when the playlist page did not include one). */
  spotifyId: string | null;
};

export type Resolved = {
  kind: SourceKind;
  name: string;
  description: string | null;
  owner: string | null;
  coverUrl: string | null;
  items: ResolvedItem[];
  /** Spotify without API credentials lists at most 100 tracks. */
  limited: boolean;
};

export class LinkError extends Error {}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36";

const SPOTIFY_URI = /^spotify:(playlist|album|track):([A-Za-z0-9]{10,40})$/;
const SPOTIFY_PATH = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{10,40})/;

/** Recognises Spotify, SoundCloud and YouTube links (short links are followed). */
export async function parseLink(input: string): Promise<ParsedLink> {
  const raw = input.trim();
  const uri = SPOTIFY_URI.exec(raw);
  if (uri) return { kind: "spotify", type: uri[1] as "playlist", id: uri[2]! };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new LinkError("not a link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("not a link");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "spotify.link" || host === "spotify.app.link" || host === "on.soundcloud.com") {
    return parseLink(await followShortLink(url));
  }
  if (host === "open.spotify.com" || host === "play.spotify.com") {
    const m = SPOTIFY_PATH.exec(url.pathname);
    if (!m) throw new LinkError("open a Spotify playlist, album or track and copy its link");
    return { kind: "spotify", type: m[1] as "playlist", id: m[2]! };
  }
  if (host === "soundcloud.com" || host === "m.soundcloud.com") {
    if (url.pathname.split("/").filter(Boolean).length < 2) throw new LinkError("copy the link of a SoundCloud set or track");
    url.hostname = "soundcloud.com";
    url.search = "";
    return { kind: "soundcloud", url: url.toString() };
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    return { kind: "youtube", url: url.toString() };
  }
  throw new LinkError("only Spotify, SoundCloud and YouTube links can be imported");
}

async function followShortLink(url: URL): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const final = new URL(res.url);
  if (!/(^|\.)spotify\.link$|app\.link$|on\.soundcloud\.com$/.test(final.hostname)) return final.toString();
  // Branch.io pages redirect in JavaScript: pick the target out of the page.
  const html = await res.text();
  const m = /https:\/\/(?:open\.spotify\.com|soundcloud\.com)\/[^"'\s<>\\]+/.exec(html);
  if (!m) throw new LinkError("could not open the short link");
  return m[0];
}

// ---------- Spotify ----------

type EmbedTrack = { uri?: string; title?: string; subtitle?: string; duration?: number; artists?: { name: string }[] };
type EmbedEntity = {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  artists?: { name: string }[];
  coverArt?: { sources?: { url: string; width?: number | null }[] };
  visualIdentity?: { image?: { url: string; maxWidth?: number | null }[] };
  releaseDate?: { isoString?: string } | null;
  duration?: number;
  trackList?: EmbedTrack[];
};

const splitArtists = (s: string | undefined) =>
  (s ?? "")
    .split(/, |,\s+/)
    .map((a) => a.trim())
    .filter(Boolean);

const yearOf = (s: string | null | undefined) => {
  const y = Number(s?.slice(0, 4));
  return Number.isInteger(y) && y > 0 ? y : null;
};

const largest = (images: { url: string; width?: number | null }[] | undefined) =>
  images?.length ? [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]!.url : null;

const trackIdOf = (uri: string | undefined) => /^spotify:track:([A-Za-z0-9]+)$/.exec(uri ?? "")?.[1] ?? null;

async function spotifyEmbed(type: string, id: string): Promise<EmbedEntity> {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new LinkError(`Spotify ${type} not found (is it private?)`);
  if (!res.ok) throw new Error(`Spotify answered HTTP ${res.status}`);
  const html = await res.text();
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const entity = m
    ? (JSON.parse(m[1]!) as { props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } } }).props?.pageProps
        ?.state?.data?.entity
    : undefined;
  if (!entity) throw new Error("Spotify page format changed; update the server");
  return entity;
}

async function spotifyFromEmbed(type: "playlist" | "album" | "track", id: string): Promise<Resolved> {
  const e = await spotifyEmbed(type, id);
  const name = (e.name ?? e.title ?? "").trim() || "Imported playlist";
  const cover =
    largest(e.coverArt?.sources) ?? largest(e.visualIdentity?.image?.map((i) => ({ url: i.url, width: i.maxWidth ?? null })));
  if (type === "track") {
    const artists = e.artists?.map((a) => a.name).filter(Boolean) ?? splitArtists(e.subtitle);
    return {
      kind: "spotify",
      name,
      description: null,
      owner: artists.join(", ") || null,
      coverUrl: cover,
      limited: false,
      items: [
        {
          title: name,
          artists,
          album: null,
          albumArtist: null,
          year: yearOf(e.releaseDate?.isoString),
          trackNo: null,
          discNo: null,
          durationMs: e.duration ?? null,
          coverUrl: cover,
          source: `spotify:track:${id}`,
          url: null,
          spotifyId: id,
        },
      ],
    };
  }
  const list = e.trackList ?? [];
  const isAlbum = type === "album";
  const items: ResolvedItem[] = list.flatMap((t, i) => {
    const tid = trackIdOf(t.uri);
    if (!tid || !t.title) return []; // podcasts episodes, local files
    return [
      {
        title: t.title,
        artists: splitArtists(t.subtitle),
        album: isAlbum ? name : null,
        albumArtist: isAlbum ? (e.subtitle ?? null) : null,
        year: isAlbum ? yearOf(e.releaseDate?.isoString) : null,
        trackNo: isAlbum ? i + 1 : null,
        discNo: null,
        durationMs: t.duration ?? null,
        coverUrl: isAlbum ? cover : null,
        source: `spotify:track:${tid}`,
        url: null,
        spotifyId: tid,
      },
    ];
  });
  return {
    kind: "spotify",
    name,
    description: null,
    owner: e.subtitle?.trim() || null,
    coverUrl: cover,
    items,
    limited: list.length >= 100,
  };
}

// Web API (optional credentials): full track lists, album names and per-track covers.

let apiToken: { value: string; expires: number; key: string } | null = null;

async function spotifyToken(clientId: string, secret: string): Promise<string> {
  const key = `${clientId}:${secret}`;
  if (apiToken && apiToken.key === key && apiToken.expires > Date.now() + 60_000) return apiToken.value;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(key).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Spotify credentials were rejected (HTTP ${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  apiToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000, key };
  return body.access_token;
}

type ApiImage = { url: string; width?: number | null };
type ApiTrack = {
  id: string | null;
  type?: string;
  name: string;
  is_local?: boolean;
  duration_ms: number;
  track_number?: number;
  disc_number?: number;
  artists: { name: string }[];
  album?: { name: string; artists?: { name: string }[]; images?: ApiImage[]; release_date?: string };
};

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(path.startsWith("https://") ? path : `https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw Object.assign(new Error(`Spotify API HTTP ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

function fromApiTrack(t: ApiTrack, album?: { name: string; artist: string | null; cover: string | null; year: number | null }): ResolvedItem | null {
  if (!t.id || t.is_local || (t.type && t.type !== "track")) return null;
  return {
    title: t.name,
    artists: t.artists.map((a) => a.name).filter(Boolean),
    album: album?.name ?? t.album?.name ?? null,
    albumArtist: album?.artist ?? t.album?.artists?.[0]?.name ?? null,
    year: album?.year ?? yearOf(t.album?.release_date),
    trackNo: t.track_number ?? null,
    discNo: t.disc_number ?? null,
    durationMs: t.duration_ms,
    coverUrl: album?.cover ?? largest(t.album?.images),
    source: `spotify:track:${t.id}`,
    url: null,
    spotifyId: t.id,
  };
}

async function spotifyFromApi(type: "playlist" | "album" | "track", id: string, token: string): Promise<Resolved> {
  if (type === "track") {
    const t = await api<ApiTrack>(token, `/tracks/${id}`);
    const item = fromApiTrack(t);
    if (!item) throw new LinkError("this Spotify item is not a song");
    return { kind: "spotify", name: t.name, description: null, owner: item.artists.join(", "), coverUrl: item.coverUrl, items: [item], limited: false };
  }
  if (type === "album") {
    type A = { name: string; artists: { name: string }[]; images: ApiImage[]; release_date: string; tracks: { items: ApiTrack[]; next: string | null } };
    const a = await api<A>(token, `/albums/${id}`);
    const meta = { name: a.name, artist: a.artists[0]?.name ?? null, cover: largest(a.images), year: yearOf(a.release_date) };
    const tracks = [...a.tracks.items];
    for (let next = a.tracks.next; next; ) {
      const page = await api<{ items: ApiTrack[]; next: string | null }>(token, next);
      tracks.push(...page.items);
      next = page.next;
    }
    return {
      kind: "spotify",
      name: a.name,
      description: null,
      owner: a.artists.map((x) => x.name).join(", "),
      coverUrl: meta.cover,
      items: tracks.flatMap((t) => fromApiTrack(t, meta) ?? []),
      limited: false,
    };
  }
  type P = { name: string; description?: string | null; owner?: { display_name?: string | null }; images?: ApiImage[] | null };
  const p = await api<P>(token, `/playlists/${id}?fields=name,description,owner(display_name),images`);
  type Entry = { track?: ApiTrack | null; item?: ApiTrack | null };
  const items: ResolvedItem[] = [];
  let next: string | null = `/playlists/${id}/tracks?limit=100&additional_types=track`;
  while (next) {
    let page: { items: Entry[]; next: string | null };
    try {
      page = await api(token, next);
    } catch (err) {
      // Newer API versions renamed the playlist tracks endpoint.
      if ((err as { status?: number }).status !== 404 || !next.includes("/tracks?")) throw err;
      next = next.replace("/tracks?", "/items?");
      continue;
    }
    for (const e of page.items) {
      const item = fromApiTrack((e.track ?? e.item) as ApiTrack);
      if (item) items.push(item);
    }
    next = page.next;
  }
  return {
    kind: "spotify",
    name: p.name,
    description: stripHtml(p.description),
    owner: p.owner?.display_name ?? null,
    coverUrl: largest(p.images ?? undefined),
    items,
    limited: false,
  };
}

const stripHtml = (s: string | null | undefined) =>
  s
    ?.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .trim() || null;

/** Album cover of a Spotify track (public oEmbed endpoint, no credentials). */
export async function spotifyTrackCover(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { thumbnail_url?: string }).thumbnail_url ?? null;
  } catch {
    return null;
  }
}

export async function resolveSpotify(
  link: Extract<ParsedLink, { kind: "spotify" }>,
  creds: { id: string | null; secret: string | null },
): Promise<Resolved> {
  if (creds.id && creds.secret) {
    try {
      return await spotifyFromApi(link.type, link.id, await spotifyToken(creds.id, creds.secret));
    } catch (err) {
      // Spotify-owned (editorial) playlists are hidden from third-party apps; the public page still lists them.
      if (err instanceof LinkError) throw err;
      console.warn(`[import] Spotify API failed (${(err as Error).message}); using the public page`);
    }
  }
  return spotifyFromEmbed(link.type, link.id);
}

// ---------- yt-dlp sources (SoundCloud, YouTube) ----------

export type YtInfo = {
  _type?: string;
  id: string;
  title?: string;
  track?: string;
  artist?: string;
  artists?: string[];
  creators?: string[];
  uploader?: string;
  channel?: string;
  album?: string;
  album_artist?: string;
  release_year?: number;
  upload_date?: string;
  duration?: number;
  genre?: string;
  description?: string;
  url?: string;
  webpage_url?: string;
  extractor_key?: string;
  ie_key?: string;
  thumbnail?: string;
  thumbnails?: { url: string; width?: number; height?: number; preference?: number }[];
  formats?: { format_id: string; vcodec?: string; acodec?: string }[];
  entries?: (YtInfo | null)[];
};

export async function ytdlpJson(ytdlp: string, args: string[], signal?: AbortSignal): Promise<YtInfo> {
  const r = await run([ytdlp, "-J", "--no-warnings", "--no-progress", ...args], { signal, timeoutMs: 5 * 60_000 });
  if (r.code !== 0) throw new Error(errorLine(r.stderr, "yt-dlp failed"));
  return JSON.parse(r.stdout) as YtInfo;
}

export function bestThumb(info: YtInfo): string | null {
  const list = info.thumbnails?.filter((t) => t.url && !/-mini\.|-tiny\.|-small\./.test(t.url)) ?? [];
  if (list.length) {
    const sorted = [...list].sort(
      (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) || (b.preference ?? 0) - (a.preference ?? 0),
    );
    // SoundCloud lists sizes without dimensions; "original" / "t500x500" are the big ones.
    return list.find((t) => /-original\./.test(t.url))?.url ?? list.find((t) => /-t500x500\./.test(t.url))?.url ?? sorted[0]!.url;
  }
  return info.thumbnail ?? null;
}

/**
 * Drops upload noise from a title: "(Official Video)", "[unreleased]", "(snippet)", "(prod. X)", "prod by X",
 * "free download", trailing #hashtags. Never returns an empty title.
 */
export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[([](?:official|lyrics?|audio|video|music video|visuali[sz]er|hd|hq|4k|mv|unreleased|snippet|leak(?:ed)?|prod\b|prod\.|produced by|free (?:download|dl)|out now|premiere)[^)\]]*[)\]]/gi, "")
    .replace(/\s+(?:\||\/\/)?\s*(?:prod\.?|produced by)\s+[^()[\]]+$/i, "")
    .replace(/\s+(?:unreleased|snippet|free (?:download|dl))\s*$/i, "")
    .replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || title.trim();
}

/** "Artist - Title (Official Video)" → parts, for uploads without music metadata. */
export function splitVideoTitle(title: string): { artist: string | null; title: string } {
  const cleaned = cleanTitle(title);
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(cleaned);
  return m ? { artist: m[1]!.trim(), title: m[2]!.trim() } : { artist: null, title: cleaned };
}

/** True when an "X - Title" prefix names this artist (any spelling or script, features allowed). */
export function prefixIsArtist(prefix: string, artist: string): boolean {
  const first = splitCredit(prefix, true)[0];
  if (!first) return false;
  if (first.key === nameKey(artist)) return true;
  return similarity(skeleton(first.name), skeleton(artist)) >= SUGGEST_MIN;
}

/** An imported title shown under `artist`: cleaned, and without an "Artist - " prefix naming that artist. */
export function titleForArtist(title: string, artist: string): string {
  const parts = splitVideoTitle(title);
  return parts.artist && prefixIsArtist(parts.artist, artist) ? parts.title : cleanTitle(title);
}

export function artistsOf(info: YtInfo): string[] {
  if (info.artists?.length) return info.artists;
  if (info.artist) return info.artist.split(/,\s*/).filter(Boolean);
  const who = (info.uploader ?? info.channel ?? "").replace(/\s+-\s+Topic$/, "").trim();
  return who ? [who] : [];
}

function sourceOf(kind: "soundcloud" | "youtube", info: YtInfo): string {
  return `${kind}:${info.id}`;
}

export async function resolveYtdlp(link: Extract<ParsedLink, { kind: "soundcloud" | "youtube" }>, ytdlp: string): Promise<Resolved> {
  const info = await ytdlpJson(ytdlp, ["--flat-playlist", link.url]);
  const entries = info._type === "playlist" ? (info.entries ?? []).filter((e): e is YtInfo => !!e?.id) : [info];
  if (!entries.length) throw new LinkError("this playlist is empty or private");
  const isPlaylist = info._type === "playlist";
  // A SoundCloud set (album, EP or playlist) becomes the album of its songs; a single song is its own single.
  const setName = link.kind === "soundcloud" && isPlaylist && /\/sets\//.test(link.url) ? info.title?.trim() || null : null;
  const items: ResolvedItem[] = entries.map((e) => {
    const fromTitle = !e.track && e.title ? splitVideoTitle(e.title) : null;
    const artists = e.artists?.length || e.artist ? artistsOf(e) : fromTitle?.artist ? [fromTitle.artist] : artistsOf(e);
    return {
      title: e.track ?? fromTitle?.title ?? e.title ?? "",
      artists,
      album: e.album ?? setName,
      albumArtist: e.album_artist ?? null,
      year: e.release_year ?? null,
      trackNo: null,
      discNo: null,
      durationMs: e.duration ? Math.round(e.duration * 1000) : null,
      coverUrl: null,
      source: sourceOf(link.kind, e),
      url: e.webpage_url ?? (e.url && /^https?:/.test(e.url) ? e.url : link.kind === "youtube" ? `https://www.youtube.com/watch?v=${e.id}` : null),
      spotifyId: null,
    };
  });
  const name = (isPlaylist ? info.title : (items[0]?.title ?? info.title))?.replace(/^Album - /, "").trim() || "Imported playlist";
  return {
    kind: link.kind,
    name,
    description: isPlaylist ? info.description?.trim() || null : null,
    owner: (info.uploader ?? info.channel)?.replace(/\s+-\s+Topic$/, "") ?? null,
    coverUrl: bestThumb(info),
    items: items.filter((i) => i.url),
    limited: false,
  };
}
