import { hasCyrillic, hasListSeparator, nameKey, renderCredit, similarity, skeleton, splitCredit, SUGGEST_MIN, type CreditPart } from "./artists";
import type { Db } from "./db";
import { albumId as makeAlbumId, artistId as makeArtistId, hash16, UNKNOWN_ARTIST } from "./ids";

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId: string;
  durationMs: number;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  mimeType: string;
  sizeBytes: number;
  bitrate: number | null;
  hasArtwork: boolean;
  addedAt: string;
  /** The admin changed title/artist/album on the server (the file's tags are untouched). */
  edited: boolean;
};
export type Album = {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  year: number | null;
  trackCount: number;
  durationMs: number;
  artworkTrackId: string | null;
};
export type Artist = {
  id: string;
  name: string;
  /** Other spellings shown as this artist (merged names, case/accent variants). */
  aliases: string[];
  /** Other artists were merged into this one by the admin (it can be unmerged). */
  merged: boolean;
  albumCount: number;
  trackCount: number;
  artworkTrackId: string | null;
};
export type MergeSuggestion = { a: Artist; b: Artist; score: number };
export type TrackEdit = { title?: string | null; artist?: string | null; album?: string | null };

/** A request the library refuses (maps to 4xx). */
export class LibraryError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
export type Page<T> = { items: T[]; total: number; limit: number; offset: number };
export type TrackSort = "added" | "title" | "artist";

export type TrackRow = {
  id: string;
  path: string;
  title: string;
  artist: string;
  artist_id: string;
  album: string;
  album_id: string;
  album_artist: string;
  album_artist_id: string;
  duration_ms: number;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  genre: string | null;
  mime: string;
  size: number;
  mtime_ms: number;
  bitrate: number | null;
  has_art: number;
  added_at: string;
  /** DB rows only (scanned rows take their tags from title/artist/album/album_artist). */
  edited?: number;
  tag_title?: string;
  tag_artist?: string;
  tag_album?: string;
  tag_album_artist?: string;
};
type AlbumRow = {
  id: string;
  title: string;
  artist: string;
  artist_id: string;
  year: number | null;
  track_count: number;
  duration_ms: number;
  artwork_track_id: string | null;
};
type ArtistRow = {
  id: string;
  key: string;
  name: string;
  aliases: string;
  merged: number;
  album_count: number;
  track_count: number;
  artwork_track_id: string | null;
};
type EditRow = { track_id: string; title: string | null; artist: string | null; album: string | null };

export const toTrack = (r: TrackRow): Track => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  album: r.album,
  albumId: r.album_id,
  artistId: r.artist_id,
  durationMs: r.duration_ms,
  trackNumber: r.track_no,
  discNumber: r.disc_no,
  year: r.year,
  genre: r.genre,
  mimeType: r.mime,
  sizeBytes: r.size,
  bitrate: r.bitrate,
  hasArtwork: r.has_art === 1,
  addedAt: r.added_at,
  edited: r.edited === 1,
});
const toAlbum = (r: AlbumRow): Album => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  artistId: r.artist_id,
  year: r.year,
  trackCount: r.track_count,
  durationMs: r.duration_ms,
  artworkTrackId: r.artwork_track_id,
});
const toArtist = (r: ArtistRow): Artist => ({
  id: r.id,
  name: r.name,
  aliases: r.aliases ? r.aliases.split("\n") : [],
  merged: r.merged === 1,
  albumCount: r.album_count,
  trackCount: r.track_count,
  artworkTrackId: r.artwork_track_id,
});

const TRACK_ORDER: Record<TrackSort, string> = {
  added: "t.added_at DESC, t.id",
  title: "t.title COLLATE NOCASE, t.id",
  artist: "t.artist COLLATE NOCASE, t.album COLLATE NOCASE, t.disc_no, t.track_no, t.id",
};
const ALBUM_TRACK_ORDER = "COALESCE(t.disc_no, 1), t.track_no IS NULL, t.track_no, t.title COLLATE NOCASE";

type Table = "tracks" | "albums" | "artists";
const SEARCH_COLUMNS: Record<Table, string[]> = {
  tracks: ["title", "artist", "album"],
  albums: ["title", "artist"],
  artists: ["name", "aliases"],
};

type Filter = { from: string; where: string; params: string[]; rank: string | null };

/** Splits a free-text query into word tokens (letters/digits/marks), max 8. */
export function tokenize(q: string): string[] {
  return (q.normalize("NFKC").match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).slice(0, 8);
}

export class Library {
  constructor(private readonly db: Db) {}

  private get sql() {
    return this.db.sql;
  }

  // ---------- filters / search ----------

  /** null ⇒ the query cannot match anything. */
  private filter(table: Table, q: string | undefined, useFts = this.db.fts): Filter | null {
    if (!q?.trim()) return { from: `${table} t`, where: "1", params: [], rank: null };
    const tokens = tokenize(q);
    if (tokens.length === 0) return null;
    if (useFts) {
      const fts = `${table}_fts`;
      return {
        from: `${fts} JOIN ${table} t ON t.rowid = ${fts}.rowid`,
        where: `${fts} MATCH ?`,
        params: [tokens.map((tok) => `"${tok}"*`).join(" ")],
        rank: `${fts}.rank`,
      };
    }
    const cols = SEARCH_COLUMNS[table];
    return {
      from: `${table} t`,
      where: tokens.map(() => `(${cols.map((c) => `t.${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`).join(" AND "),
      params: tokens.flatMap((tok) => cols.map(() => `%${tok.replace(/[\\%_]/g, "\\$&")}%`)),
      rank: null,
    };
  }

  private page<R, T>(
    table: Table,
    q: string | undefined,
    order: string | null,
    defaultOrder: string,
    limit: number,
    offset: number,
    map: (row: R) => T,
    withTotal = true,
  ): Page<T> {
    const run = (useFts: boolean): Page<T> => {
      const f = this.filter(table, q, useFts);
      if (!f) return { items: [], total: 0, limit, offset };
      const orderBy = order ?? f.rank ?? defaultOrder;
      const rows = this.sql
        .query<R, (string | number)[]>(`SELECT t.* FROM ${f.from} WHERE ${f.where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .all(...f.params, limit, offset);
      const total = withTotal
        ? this.sql.query<{ n: number }, string[]>(`SELECT COUNT(*) AS n FROM ${f.from} WHERE ${f.where}`).get(...f.params)!.n
        : rows.length;
      return { items: rows.map(map), total, limit, offset };
    };
    if (!this.db.fts || !q?.trim()) return run(this.db.fts);
    try {
      return run(true);
    } catch (err) {
      console.warn(`[search] FTS query failed, using LIKE: ${(err as Error).message}`);
      return run(false);
    }
  }

  listTracks(o: { q?: string; sort?: TrackSort; limit: number; offset: number }): Page<Track> {
    const order = o.sort ? TRACK_ORDER[o.sort] : o.q?.trim() ? null : TRACK_ORDER.added;
    return this.page<TrackRow, Track>("tracks", o.q, order, TRACK_ORDER.title, o.limit, o.offset, toTrack);
  }

  listAlbums(o: { q?: string; limit: number; offset: number }): Page<Album> {
    const order = o.q?.trim() ? null : "t.title COLLATE NOCASE, t.id";
    return this.page<AlbumRow, Album>("albums", o.q, order, "t.title COLLATE NOCASE, t.id", o.limit, o.offset, toAlbum);
  }

  listArtists(o: { q?: string; limit: number; offset: number }): Page<Artist> {
    const order = o.q?.trim() ? null : "t.name COLLATE NOCASE, t.id";
    return this.page<ArtistRow, Artist>("artists", o.q, order, "t.name COLLATE NOCASE, t.id", o.limit, o.offset, toArtist);
  }

  search(q: string, limit: number): { tracks: Track[]; albums: Album[]; artists: Artist[] } {
    if (!q.trim()) return { tracks: [], albums: [], artists: [] };
    return {
      tracks: this.page<TrackRow, Track>("tracks", q, null, TRACK_ORDER.title, limit, 0, toTrack, false).items,
      albums: this.page<AlbumRow, Album>("albums", q, null, "t.title COLLATE NOCASE", limit, 0, toAlbum, false).items,
      artists: this.page<ArtistRow, Artist>("artists", q, null, "t.name COLLATE NOCASE", limit, 0, toArtist, false).items,
    };
  }

  // ---------- lookups ----------

  trackCount(): number {
    return this.sql.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tracks").get()!.n;
  }

  tracksByIds(ids: readonly string[]): Track[] {
    const q = this.sql.query<TrackRow, [string]>("SELECT * FROM tracks WHERE id = ?");
    return ids.flatMap((id) => {
      const r = q.get(id);
      return r ? [toTrack(r)] : [];
    });
  }

  trackRow(id: string): TrackRow | null {
    return this.sql.query<TrackRow, [string]>("SELECT * FROM tracks WHERE id = ?").get(id);
  }

  getAlbum(id: string): (Album & { tracks: Track[] }) | null {
    const byId = this.sql.query<AlbumRow, [string]>("SELECT * FROM albums WHERE id = ?");
    // An id from before an artist merge/rename or a track edit still opens the album.
    const row =
      byId.get(id) ??
      byId.get(this.sql.query<{ album_id: string }, [string]>("SELECT album_id FROM album_lookup WHERE id = ?").get(id)?.album_id ?? "");
    if (!row) return null;
    id = row.id;
    const tracks = this.sql
      .query<TrackRow, [string]>(`SELECT t.* FROM tracks t WHERE t.album_id = ? ORDER BY ${ALBUM_TRACK_ORDER}`)
      .all(id);
    return { ...toAlbum(row), tracks: tracks.map(toTrack) };
  }

  /** The artist row for an id, following old ids (merged/renamed artists, other spellings, whole credits). */
  private artistRow(id: string): ArtistRow | null {
    const byId = this.sql.query<ArtistRow, [string]>("SELECT * FROM artists WHERE id = ?");
    const direct = byId.get(id);
    if (direct) return direct;
    const to = this.sql.query<{ artist_id: string }, [string]>("SELECT artist_id FROM artist_lookup WHERE id = ?").get(id);
    return to ? byId.get(to.artist_id) : null;
  }

  private artistByKey(key: string): ArtistRow | null {
    return this.sql.query<ArtistRow, [string]>("SELECT * FROM artists WHERE key = ?").get(key);
  }

  getArtist(id: string): (Artist & { albums: Album[]; tracks: Track[] }) | null {
    const row = this.artistRow(id);
    if (!row) return null;
    id = row.id;
    const albums = this.sql
      .query<AlbumRow, [string]>(
        `SELECT a.* FROM artist_albums aa JOIN albums a ON a.id = aa.album_id
         WHERE aa.artist_id = ? ORDER BY a.year DESC NULLS LAST, a.title COLLATE NOCASE`,
      )
      .all(id);
    const tracks = this.sql
      .query<TrackRow, [string]>(
        `SELECT t.* FROM track_artists ta JOIN tracks t ON t.id = ta.track_id WHERE ta.artist_id = ?
         ORDER BY t.year DESC NULLS LAST, t.album COLLATE NOCASE, t.album_id, ${ALBUM_TRACK_ORDER}`,
      )
      .all(id);
    return { ...toArtist(row), albums: albums.map(toAlbum), tracks: tracks.map(toTrack) };
  }

  /** path → (size, mtime) of every indexed file, for incremental scans. */
  fileStates(): Map<string, { id: string; size: number; mtimeMs: number }> {
    const rows = this.sql
      .query<{ id: string; path: string; size: number; mtime_ms: number }, []>("SELECT id, path, size, mtime_ms FROM tracks")
      .all();
    return new Map(rows.map((r) => [r.path, { id: r.id, size: r.size, mtimeMs: r.mtime_ms }]));
  }

  // ---------- writes ----------

  /** Inserts or updates tracks (keeps the original addedAt). Returns ids that were new. */
  upsertTracks(rows: TrackRow[]): string[] {
    const exists = this.sql.query<{ x: number }, [string]>("SELECT 1 AS x FROM tracks WHERE id = ?");
    const upsert = this.sql.query(
      `INSERT INTO tracks (id, path, title, artist, artist_id, album, album_id, album_artist, album_artist_id, duration_ms,
         track_no, disc_no, year, genre, mime, size, mtime_ms, bitrate, has_art, added_at,
         tag_title, tag_artist, tag_album, tag_album_artist)
       VALUES ($id, $path, $title, $artist, $artist_id, $album, $album_id, $album_artist, $album_artist_id, $duration_ms,
         $track_no, $disc_no, $year, $genre, $mime, $size, $mtime_ms, $bitrate, $has_art, $added_at,
         $title, $artist, $album, $album_artist)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path, title = excluded.title, artist = excluded.artist, artist_id = excluded.artist_id,
         album = excluded.album, album_id = excluded.album_id, album_artist = excluded.album_artist,
         album_artist_id = excluded.album_artist_id, duration_ms = excluded.duration_ms, track_no = excluded.track_no,
         disc_no = excluded.disc_no, year = excluded.year, genre = excluded.genre, mime = excluded.mime,
         size = excluded.size, mtime_ms = excluded.mtime_ms, bitrate = excluded.bitrate, has_art = excluded.has_art,
         tag_title = excluded.tag_title, tag_artist = excluded.tag_artist, tag_album = excluded.tag_album,
         tag_album_artist = excluded.tag_album_artist`,
    );
    const added: string[] = [];
    this.sql.transaction(() => {
      for (const row of rows) {
        if (!exists.get(row.id)) added.push(row.id);
        upsert.run({
          id: row.id, path: row.path, title: row.title, artist: row.artist, artist_id: row.artist_id, album: row.album,
          album_id: row.album_id, album_artist: row.album_artist, album_artist_id: row.album_artist_id,
          duration_ms: row.duration_ms, track_no: row.track_no, disc_no: row.disc_no, year: row.year, genre: row.genre,
          mime: row.mime, size: row.size, mtime_ms: row.mtime_ms, bitrate: row.bitrate, has_art: row.has_art,
          added_at: row.added_at,
        });
      }
    })();
    return added;
  }

  /** Deletes tracks and retires their ids (see `isIdTaken`). */
  deleteTracks(ids: string[]): void {
    const del = this.sql.query<unknown, [string]>("DELETE FROM tracks WHERE id = ?");
    const retire = this.sql.query<unknown, [string]>("INSERT OR IGNORE INTO retired_ids (id) VALUES (?)");
    const forget = this.sql.query<unknown, [string]>("DELETE FROM track_edits WHERE track_id = ?");
    this.sql.transaction(() => {
      for (const id of ids) {
        del.run(id);
        retire.run(id);
        forget.run(id);
      }
    })();
  }

  /** The subset of `ids` this server deleted (retired and not indexed again). Unknown ids are not "gone". */
  goneIds(ids: readonly string[]): string[] {
    const q = this.sql.query<{ x: number }, [string]>(
      "SELECT 1 AS x FROM retired_ids r WHERE r.id = ?1 AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.id = ?1)",
    );
    return ids.filter((id) => q.get(id) != null);
  }

  /** True when `id` is indexed now or was ever deleted; new uploads must pick a path with a fresh id. */
  isIdTaken(id: string): boolean {
    return (
      this.sql
        .query<{ x: number }, [string, string]>(
          "SELECT 1 AS x FROM tracks WHERE id = ? UNION ALL SELECT 1 FROM retired_ids WHERE id = ? LIMIT 1",
        )
        .get(id, id) != null
    );
  }


  // ---------- artist identity / admin edits ----------

  /**
   * Recomputes everything derived from the tracks' tags: effective title/artist/album (admin edits and artist
   * merges applied), track_artists (featured artists included), albums, artists, artist_albums, the old-id
   * lookups and the FTS indexes.
   */
  rebuildAggregates(): void {
    const sql = this.sql;
    sql.transaction(() => {
      type Row = Required<Pick<TrackRow, "id" | "path" | "title" | "artist" | "artist_id" | "album" | "album_id" | "album_artist" | "album_artist_id" | "edited" | "tag_title" | "tag_artist" | "tag_album" | "tag_album_artist">>;
      const rows = sql
        .query<Row, []>(
          `SELECT id, path, title, artist, artist_id, album, album_id, album_artist, album_artist_id, edited,
             tag_title, tag_artist, tag_album, tag_album_artist FROM tracks`,
        )
        .all();
      const edits = new Map(sql.query<EditRow, []>("SELECT * FROM track_edits").all().map((e) => [e.track_id, e]));
      const merges = new Map(sql.query<{ key: string; into_key: string }, []>("SELECT key, into_key FROM artist_merges").all().map((m) => [m.key, m.into_key]));
      const chosen = new Map(sql.query<{ key: string; name: string }, []>("SELECT key, name FROM artist_names").all().map((n) => [n.key, n.name]));
      const root = (key: string) => merges.get(key) ?? key;
      const unknown: CreditPart = { name: UNKNOWN_ARTIST, key: nameKey(UNKNOWN_ARTIST) };

      // 1. What each track says (file tags, or the admin's edit).
      const eff = rows.map((r) => {
        const e = edits.get(r.id);
        const credit = e?.artist ?? r.tag_artist;
        // An edited artist also becomes the album artist when the tags had no separate one.
        const albumCredit = e?.artist != null && r.tag_album_artist === r.tag_artist ? e.artist : r.tag_album_artist;
        // Imports join the source's artist list with ", ", and an admin typed the edit: their commas are lists.
        const reliable = r.path.startsWith("imports/") || e?.artist != null;
        return { r, title: e?.title ?? r.tag_title, album: e?.album ?? r.tag_album, credit, albumCredit, reliable, edited: e ? 1 : 0 };
      });

      // 2. Names that are a whole credit somewhere: "A, B" splits into artists when one of them is known alone,
      // so "Tyler, The Creator" stays one artist unless "Tyler" exists on its own.
      const solo = new Set<string>();
      for (const x of eff)
        for (const c of [x.credit, x.albumCredit]) if (!hasListSeparator(c)) for (const p of splitCredit(c, false)) solo.add(p.key);
      const lists = (reliable: boolean, credit: string) =>
        hasListSeparator(credit) && (reliable || splitCredit(credit, true).some((p) => solo.has(p.key)));

      const parsed = eff.map((x) => {
        const split = lists(x.reliable, x.credit);
        const parts = splitCredit(x.credit, split);
        const albumParts = splitCredit(x.albumCredit, lists(x.reliable, x.albumCredit));
        return { ...x, split, parts: parts.length ? parts : [unknown], albumArtist: albumParts[0] ?? parts[0] ?? unknown };
      });

      // 3. Spellings per artist (root key), with how many tracks use each.
      const spellings = new Map<string, Map<string, Set<string>>>();
      for (const x of parsed)
        for (const p of [...x.parts, x.albumArtist]) {
          const k = root(p.key);
          let names = spellings.get(k);
          if (!names) spellings.set(k, (names = new Map()));
          let ids = names.get(p.name);
          if (!ids) names.set(p.name, (ids = new Set()));
          ids.add(x.r.id);
        }

      // 4. Display name (the admin's choice, else the most used spelling) and id (sha1 of the display name, so
      // an artist with one spelling keeps the id older servers gave it).
      const display = new Map<string, string>();
      const ids = new Map<string, string>();
      const used = new Set<string>();
      for (const k of [...spellings.keys()].sort()) {
        const names = spellings.get(k)!;
        const name =
          chosen.get(k) ??
          [...names].sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b))[0]![0];
        display.set(k, name);
        let id = makeArtistId(name);
        if (used.has(id)) id = hash16(`${name}\u0000${k}`);
        used.add(id);
        ids.set(k, id);
      }
      const shown = (p: CreditPart) => display.get(root(p.key)) ?? p.name;
      const idOf = (p: CreditPart) => ids.get(root(p.key))!;

      // 5. Effective track columns + who is credited on each track.
      sql.exec("DELETE FROM track_artists; DELETE FROM artist_lookup; DELETE FROM album_lookup;");
      const update = sql.query(
        `UPDATE tracks SET title = $title, artist = $artist, artist_id = $artist_id, album = $album, album_id = $album_id,
           album_artist = $album_artist, album_artist_id = $album_artist_id, edited = $edited WHERE id = $id`,
      );
      const credit = sql.query("INSERT OR IGNORE INTO track_artists (artist_id, track_id) VALUES (?, ?)");
      const artistLookup = sql.query("INSERT OR IGNORE INTO artist_lookup (id, artist_id) VALUES (?, ?)");
      const albumLookup = sql.query("INSERT OR IGNORE INTO album_lookup (id, album_id) VALUES (?, ?)");
      for (const x of parsed) {
        const albumArtist = shown(x.albumArtist);
        const next = {
          id: x.r.id,
          title: x.title,
          artist: renderCredit(x.credit, x.split, shown),
          artist_id: idOf(x.parts[0]!),
          album: x.album,
          album_id: makeAlbumId(albumArtist, x.album),
          album_artist: albumArtist,
          album_artist_id: idOf(x.albumArtist),
          edited: x.edited,
        };
        const r = x.r;
        if (
          r.title !== next.title || r.artist !== next.artist || r.artist_id !== next.artist_id || r.album !== next.album ||
          r.album_id !== next.album_id || r.album_artist !== next.album_artist || r.album_artist_id !== next.album_artist_id ||
          r.edited !== next.edited
        )
          update.run(next);
        for (const p of [...x.parts, x.albumArtist]) credit.run(idOf(p), r.id);
        // Ids the app may hold from before: a spelling, a whole credit, the tag-based album id.
        for (const p of [...x.parts, x.albumArtist]) if (makeArtistId(p.name) !== idOf(p)) artistLookup.run(makeArtistId(p.name), idOf(p));
        for (const c of [r.tag_artist, x.credit]) if (makeArtistId(c) !== next.artist_id) artistLookup.run(makeArtistId(c), next.artist_id);
        if (makeArtistId(r.tag_album_artist) !== next.album_artist_id) artistLookup.run(makeArtistId(r.tag_album_artist), next.album_artist_id);
        const oldAlbum = makeAlbumId(r.tag_album_artist, r.tag_album);
        if (oldAlbum !== next.album_id) albumLookup.run(oldAlbum, next.album_id);
      }
      for (const f of sql.query<{ id: string; key: string }, []>("SELECT id, key FROM artist_former").all()) {
        const to = ids.get(root(f.key));
        if (to && to !== f.id) artistLookup.run(f.id, to);
      }

      // 6. Albums, then artists.
      sql.exec(/* sql */ `
        DELETE FROM albums;
        DELETE FROM artists;
        DELETE FROM artist_albums;

        INSERT INTO albums (id, title, artist, artist_id, year, track_count, duration_ms, artwork_track_id)
        SELECT t.album_id, MIN(t.album), MIN(t.album_artist), MIN(t.album_artist_id), MAX(t.year), COUNT(*), SUM(t.duration_ms),
          (SELECT x.id FROM tracks x WHERE x.album_id = t.album_id AND x.has_art = 1
           ORDER BY COALESCE(x.disc_no, 1), x.track_no IS NULL, x.track_no LIMIT 1)
        FROM tracks t GROUP BY t.album_id;

        INSERT INTO artist_albums (artist_id, album_id)
        SELECT DISTINCT ta.artist_id, t.album_id FROM track_artists ta JOIN tracks t ON t.id = ta.track_id;
      `);
      const mergedInto = new Set(merges.values());
      const insertArtist = sql.query(
        `INSERT INTO artists (id, key, name, aliases, merged, album_count, track_count, artwork_track_id)
         VALUES ($id, $key, $name, $aliases, $merged, 0, 0, NULL)`,
      );
      for (const [k, names] of spellings) {
        const name = display.get(k)!;
        const aliases = [...names.keys()].filter((n) => n !== name);
        insertArtist.run({ id: ids.get(k)!, key: k, name, aliases: aliases.join("\n"), merged: mergedInto.has(k) ? 1 : 0 });
      }
      sql.exec(/* sql */ `
        UPDATE artists SET
          album_count = (SELECT COUNT(*) FROM artist_albums aa WHERE aa.artist_id = artists.id),
          track_count = (SELECT COUNT(*) FROM track_artists ta WHERE ta.artist_id = artists.id),
          artwork_track_id = (SELECT a.artwork_track_id FROM artist_albums aa JOIN albums a ON a.id = aa.album_id
            WHERE aa.artist_id = artists.id AND a.artwork_track_id IS NOT NULL
            ORDER BY a.artist_id = artists.id DESC, a.year DESC NULLS LAST LIMIT 1);
      `);
      if (this.db.fts) {
        sql.exec("INSERT INTO albums_fts(albums_fts) VALUES ('rebuild')");
        sql.exec("INSERT INTO artists_fts(artists_fts) VALUES ('rebuild')");
      }
    })();
  }

  /** Remembers the ids these artists have now, so links made before a merge/rename keep working. */
  private rememberIds(rows: ArtistRow[]): void {
    const q = this.sql.query("INSERT OR REPLACE INTO artist_former (id, key) VALUES (?, ?)");
    for (const r of rows) q.run(r.id, r.key);
  }

  private requireArtist(id: string): ArtistRow {
    return this.artistRow(id) ?? (() => { throw new LibraryError(404, "artist not found"); })();
  }

  private artistResult(key: string): Artist & { albums: Album[]; tracks: Track[] } {
    const row = this.artistByKey(key);
    if (!row) throw new LibraryError(404, "artist not found");
    return this.getArtist(row.id)!;
  }

  /**
   * Shows the given artists as one: the first is kept, the others become its spellings. `name` is the display
   * name (any of their spellings, or a new one).
   */
  mergeArtists(ids: string[], name: string): Artist & { albums: Album[]; tracks: Track[] } {
    const rows = ids.map((id) => this.requireArtist(id));
    const keys = [...new Set(rows.map((r) => r.key))];
    if (keys.length < 2) throw new LibraryError(400, "pick at least two different artists");
    const display = name.trim();
    if (!display) throw new LibraryError(400, "name is required");
    const target = keys[0]!;
    const owner = this.ownerOf(display);
    if (owner && !keys.includes(owner.key)) throw new LibraryError(409, `"${owner.name}" is another artist: merge it too, or pick another name`);
    this.sql.transaction(() => {
      this.rememberIds(rows);
      const repoint = this.sql.query("UPDATE artist_merges SET into_key = ? WHERE into_key = ?");
      const merge = this.sql.query("INSERT OR REPLACE INTO artist_merges (key, into_key) VALUES (?, ?)");
      const dropName = this.sql.query("DELETE FROM artist_names WHERE key = ?");
      for (const k of keys.slice(1)) {
        repoint.run(target, k);
        merge.run(k, target);
        dropName.run(k);
      }
      this.setName(target, display);
    })();
    this.rebuildAggregates();
    return this.artistResult(target);
  }

  /** Stores the display name of a root key; the name's own spelling joins the artist too. */
  private setName(target: string, name: string): void {
    this.sql.query("INSERT OR REPLACE INTO artist_names (key, name) VALUES (?, ?)").run(target, name);
    const k = nameKey(name);
    if (k !== target) this.sql.query("INSERT OR REPLACE INTO artist_merges (key, into_key) VALUES (?, ?)").run(k, target);
  }

  /** The artist a name already belongs to (its spelling or a merged spelling), if any. */
  private ownerOf(name: string): ArtistRow | null {
    const k = nameKey(name);
    const merged = this.sql.query<{ into_key: string }, [string]>("SELECT into_key FROM artist_merges WHERE key = ?").get(k);
    return this.artistByKey(merged?.into_key ?? k);
  }

  renameArtist(id: string, name: string): Artist & { albums: Album[]; tracks: Track[] } {
    const row = this.requireArtist(id);
    const display = name.trim();
    if (!display) throw new LibraryError(400, "name is required");
    const owner = this.ownerOf(display);
    if (owner && owner.key !== row.key) throw new LibraryError(409, `"${owner.name}" is another artist: merge them instead`);
    this.sql.transaction(() => {
      this.rememberIds([row]);
      this.setName(row.key, display);
    })();
    this.rebuildAggregates();
    return this.artistResult(row.key);
  }

  /** Undoes every merge into this artist (and a rename to a name of another spelling). */
  unmergeArtist(id: string): Artist & { albums: Album[]; tracks: Track[] } {
    const row = this.requireArtist(id);
    this.sql.transaction(() => {
      this.rememberIds([row]);
      this.sql.query("DELETE FROM artist_merges WHERE into_key = ?").run(row.key);
      this.sql.query("DELETE FROM artist_names WHERE key = ?").run(row.key);
    })();
    this.rebuildAggregates();
    return this.artistResult(row.key);
  }

  /** Pairs of artists whose names sound alike across scripts or spellings (Пошлая Молли / Poshlaya Molly). */
  mergeSuggestions(limit = 50): MergeSuggestion[] {
    const rows = this.sql.query<ArtistRow, []>("SELECT * FROM artists").all();
    const dismissed = new Set(
      this.sql.query<{ a_key: string; b_key: string }, []>("SELECT a_key, b_key FROM artist_dismissed").all().map((d) => `${d.a_key}\u0000${d.b_key}`),
    );
    const sk = rows.map((r) => {
      const names = [r.name, ...(r.aliases ? r.aliases.split("\n") : [])];
      return { r, skeletons: [...new Set(names.map(skeleton).filter((s) => s.length >= 3))], cyr: names.some(hasCyrillic), lat: names.some((n) => !hasCyrillic(n)) };
    });
    // Compare only names with the same first skeleton letter (keeps this near-linear on big libraries).
    const buckets = new Map<string, number[]>();
    sk.forEach((x, i) => {
      for (const c of new Set(x.skeletons.map((s) => s[0]!))) (buckets.get(c) ?? buckets.set(c, []).get(c)!).push(i);
    });
    const seen = new Set<string>();
    const out: MergeSuggestion[] = [];
    for (const list of buckets.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const x = sk[list[i]!]!;
          const y = sk[list[j]!]!;
          const [a, b] = x.r.key < y.r.key ? [x, y] : [y, x];
          const pair = `${a.r.key}\u0000${b.r.key}`;
          if (seen.has(pair) || dismissed.has(pair)) continue;
          seen.add(pair);
          let score = 0;
          for (const s of a.skeletons) for (const t of b.skeletons) score = Math.max(score, similarity(s, t));
          // Same-script look-alikes need to be closer than a transliteration pair.
          const crossScript = (a.cyr && b.lat) || (a.lat && b.cyr);
          if (score >= (crossScript ? SUGGEST_MIN : 0.92)) out.push({ a: toArtist(a.r), b: toArtist(b.r), score: Math.round(score * 100) / 100 });
        }
    return out
      .sort((p, q) => q.score - p.score || q.a.trackCount + q.b.trackCount - (p.a.trackCount + p.b.trackCount))
      .slice(0, limit);
  }

  dismissSuggestion(aId: string, bId: string): void {
    const a = this.requireArtist(aId).key;
    const b = this.requireArtist(bId).key;
    if (a === b) throw new LibraryError(400, "pick two different artists");
    this.sql.query("INSERT OR IGNORE INTO artist_dismissed (a_key, b_key) VALUES (?, ?)").run(a < b ? a : b, a < b ? b : a);
  }

  /**
   * Changes a track's title/artist/album on the server (the file is untouched; rescans keep the edit).
   * A field set to null, an empty string or the tag's own value goes back to the file's tag.
   */
  editTrack(id: string, patch: TrackEdit): Track {
    const row = this.trackRow(id);
    if (!row) throw new LibraryError(404, "track not found");
    const cur = this.sql.query<EditRow, [string]>("SELECT * FROM track_edits WHERE track_id = ?").get(id) ?? {
      track_id: id,
      title: null,
      artist: null,
      album: null,
    };
    const tags = { title: row.tag_title ?? row.title, artist: row.tag_artist ?? row.artist, album: row.tag_album ?? row.album };
    for (const f of ["title", "artist", "album"] as const) {
      const v = patch[f];
      if (v === undefined) continue;
      const t = v?.replace(/\s+/g, " ").trim() || null;
      cur[f] = t === tags[f] ? null : t;
    }
    if (cur.title === null && cur.artist === null && cur.album === null)
      this.sql.query("DELETE FROM track_edits WHERE track_id = ?").run(id);
    else
      this.sql
        .query("INSERT OR REPLACE INTO track_edits (track_id, title, artist, album) VALUES ($track_id, $title, $artist, $album)")
        .run(cur);
    this.rebuildAggregates();
    return toTrack(this.trackRow(id)!);
  }
}
