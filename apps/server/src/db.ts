import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Db = { sql: Database; fts: boolean };

const SCHEMA_VERSION = 2;

const SCHEMA = /* sql */ `
-- Per-install backup of the app's playlists and likes. id is the sha256 of the install's secret key (the raw
-- key is never stored); data is an opaque JSON object the server never interprets.
CREATE TABLE IF NOT EXISTS libraries (
  id         TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id              TEXT PRIMARY KEY,
  path            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  artist          TEXT NOT NULL,
  artist_id       TEXT NOT NULL,
  album           TEXT NOT NULL,
  album_id        TEXT NOT NULL,
  album_artist    TEXT NOT NULL,
  album_artist_id TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  track_no        INTEGER,
  disc_no         INTEGER,
  year            INTEGER,
  genre           TEXT,
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  mtime_ms        INTEGER NOT NULL,
  bitrate         INTEGER,
  has_art         INTEGER NOT NULL,
  added_at        TEXT NOT NULL,
  -- what the file's tags say; title/artist/album/album_artist above are the effective values after admin edits
  -- and artist merges (recomputed by Library.rebuildAggregates)
  tag_title        TEXT NOT NULL DEFAULT '',
  tag_artist       TEXT NOT NULL DEFAULT '',
  tag_album        TEXT NOT NULL DEFAULT '',
  tag_album_artist TEXT NOT NULL DEFAULT '',
  edited           INTEGER NOT NULL DEFAULT 0  -- 1 when track_edits has a row for it
);
CREATE INDEX IF NOT EXISTS tracks_added ON tracks(added_at DESC, id);
CREATE INDEX IF NOT EXISTS tracks_title ON tracks(title COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS tracks_artist_sort ON tracks(artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no, id);
CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album_id, disc_no, track_no);
CREATE INDEX IF NOT EXISTS tracks_artist_id ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS tracks_album_artist_id ON tracks(album_artist_id);

CREATE TABLE IF NOT EXISTS albums (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  artist           TEXT NOT NULL,
  artist_id        TEXT NOT NULL,
  year             INTEGER,
  track_count      INTEGER NOT NULL,
  duration_ms      INTEGER NOT NULL,
  artwork_track_id TEXT
);
CREATE INDEX IF NOT EXISTS albums_title ON albums(title COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS albums_artist_id ON albums(artist_id);

CREATE TABLE IF NOT EXISTS artists (
  id               TEXT PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE, -- root name key (see artists.ts nameKey)
  name             TEXT NOT NULL,
  aliases          TEXT NOT NULL,        -- other spellings, newline-separated (searchable)
  merged           INTEGER NOT NULL,     -- 1 when other artists were merged into this one
  album_count      INTEGER NOT NULL,
  track_count      INTEGER NOT NULL,
  artwork_track_id TEXT
);
CREATE INDEX IF NOT EXISTS artists_name ON artists(name COLLATE NOCASE, id);

-- ids of tracks that were deleted/removed. Uploads never reuse them: clients cache streams immutably and key
-- downloads by id, so an id must never point at different audio.
CREATE TABLE IF NOT EXISTS retired_ids (id TEXT PRIMARY KEY) WITHOUT ROWID;

-- playlist imports: the job document is JSON (items included), so the shape can grow without migrations
CREATE TABLE IF NOT EXISTS imports (
  id         TEXT PRIMARY KEY,
  doc        TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;

-- where imported audio came from (spotify:track:…, youtube:…, soundcloud:…), so re-imports reuse the file
CREATE TABLE IF NOT EXISTS import_sources (
  source   TEXT PRIMARY KEY,
  track_id TEXT NOT NULL
) WITHOUT ROWID;

-- every album an artist appears on, as track artist or album artist
CREATE TABLE IF NOT EXISTS artist_albums (
  artist_id TEXT NOT NULL,
  album_id  TEXT NOT NULL,
  PRIMARY KEY (artist_id, album_id)
) WITHOUT ROWID;

-- every artist credited on a track (featured artists included), derived
CREATE TABLE IF NOT EXISTS track_artists (
  artist_id TEXT NOT NULL,
  track_id  TEXT NOT NULL,
  PRIMARY KEY (artist_id, track_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS track_artists_track ON track_artists(track_id);

-- admin merges: the name key is shown as the artist with root key into_key
CREATE TABLE IF NOT EXISTS artist_merges (
  key      TEXT PRIMARY KEY,
  into_key TEXT NOT NULL
) WITHOUT ROWID;

-- display name chosen for a root key (on merge or rename)
CREATE TABLE IF NOT EXISTS artist_names (
  key  TEXT PRIMARY KEY,
  name TEXT NOT NULL
) WITHOUT ROWID;

-- merge suggestions the admin dismissed (a_key < b_key)
CREATE TABLE IF NOT EXISTS artist_dismissed (
  a_key TEXT NOT NULL,
  b_key TEXT NOT NULL,
  PRIMARY KEY (a_key, b_key)
) WITHOUT ROWID;

-- ids an artist was reachable under before a merge/rename, so old links still open it
CREATE TABLE IF NOT EXISTS artist_former (
  id  TEXT PRIMARY KEY,
  key TEXT NOT NULL
) WITHOUT ROWID;

-- derived: any artist id the app may still hold (old spellings, whole credits) -> current artist id
CREATE TABLE IF NOT EXISTS artist_lookup (
  id        TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL
) WITHOUT ROWID;

-- derived: album ids from the file tags (what older servers used) -> current album id
CREATE TABLE IF NOT EXISTS album_lookup (
  id       TEXT PRIMARY KEY,
  album_id TEXT NOT NULL
) WITHOUT ROWID;

-- admin edits of a track's info; NULL = keep the file's tag
CREATE TABLE IF NOT EXISTS track_edits (
  track_id TEXT PRIMARY KEY,
  title    TEXT,
  artist   TEXT,
  album    TEXT
) WITHOUT ROWID;
`;

const TOKENIZE = `tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'`;

const FTS = /* sql */ `
CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(title, artist, album, content = 'tracks', content_rowid = 'rowid', ${TOKENIZE});
CREATE VIRTUAL TABLE IF NOT EXISTS albums_fts USING fts5(title, artist, content = 'albums', content_rowid = 'rowid', ${TOKENIZE});
CREATE VIRTUAL TABLE IF NOT EXISTS artists_fts USING fts5(name, aliases, content = 'artists', content_rowid = 'rowid', ${TOKENIZE});
CREATE TRIGGER IF NOT EXISTS tracks_fts_ai AFTER INSERT ON tracks BEGIN
  INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.rowid, new.title, new.artist, new.album);
END;
CREATE TRIGGER IF NOT EXISTS tracks_fts_ad AFTER DELETE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES ('delete', old.rowid, old.title, old.artist, old.album);
END;
CREATE TRIGGER IF NOT EXISTS tracks_fts_au AFTER UPDATE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) VALUES ('delete', old.rowid, old.title, old.artist, old.album);
  INSERT INTO tracks_fts(rowid, title, artist, album) VALUES (new.rowid, new.title, new.artist, new.album);
END;
`;

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const sql = new Database(join(dataDir, "blednify.db"), { create: true, strict: true });
  sql.exec("PRAGMA journal_mode = WAL");
  sql.exec("PRAGMA synchronous = NORMAL");
  sql.exec("PRAGMA busy_timeout = 5000");
  sql.exec("PRAGMA temp_store = MEMORY");
  migrate(sql);
  sql.exec(SCHEMA);
  sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return { sql, fts: setupFts(sql) };
}

/** Upgrades a database made by an older server (before the schema creates what is missing). */
function migrate(sql: Database): void {
  const version = sql.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  const hasTracks = sql.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks'").get() != null;
  if (!hasTracks || version >= 2) return;
  sql.transaction(() => {
    // v2: file tags kept apart from effective values; artists gain key/aliases/merged (derived: rebuilt on boot).
    for (const col of ["tag_title", "tag_artist", "tag_album", "tag_album_artist"])
      sql.exec(`ALTER TABLE tracks ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    sql.exec("ALTER TABLE tracks ADD COLUMN edited INTEGER NOT NULL DEFAULT 0");
    sql.exec("UPDATE tracks SET tag_title = title, tag_artist = artist, tag_album = album, tag_album_artist = album_artist");
    sql.exec("DROP TABLE IF EXISTS artists_fts");
    sql.exec("DROP TABLE IF EXISTS artists");
  })();
}

/** Creates FTS5 tables + sync triggers. Returns false (search falls back to LIKE) if FTS5 is unavailable. */
function setupFts(sql: Database): boolean {
  const existed = sql.query("SELECT 1 FROM sqlite_master WHERE name = 'tracks_fts'").get() != null;
  try {
    sql.transaction(() => {
      sql.exec(FTS);
      if (!existed) sql.exec("INSERT INTO tracks_fts(tracks_fts) VALUES ('rebuild')");
    })();
    return true;
  } catch (err) {
    console.warn(`[db] FTS5 unavailable, search falls back to LIKE: ${(err as Error).message}`);
    for (const t of ["tracks_fts_ai", "tracks_fts_ad", "tracks_fts_au"]) sql.exec(`DROP TRIGGER IF EXISTS ${t}`);
    return false;
  }
}
