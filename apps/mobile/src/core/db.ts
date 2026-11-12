import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { localArtistId } from './util';

/** Ordered schema migrations; index + 1 === PRAGMA user_version after applying. Append only. */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE local_tracks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    album_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    track_number INTEGER,
    disc_number INTEGER,
    year INTEGER,
    genre TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    file TEXT NOT NULL,
    art TEXT,
    fingerprint TEXT NOT NULL,
    added_at TEXT NOT NULL
  );
  CREATE INDEX local_tracks_added ON local_tracks(added_at DESC);
  CREATE INDEX local_tracks_album ON local_tracks(album_id);
  CREATE INDEX local_tracks_artist ON local_tracks(artist_id);
  CREATE UNIQUE INDEX local_tracks_fingerprint ON local_tracks(fingerprint);

  CREATE TABLE downloads (
    key TEXT PRIMARY KEY NOT NULL,
    track TEXT NOT NULL,
    album_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    file TEXT NOT NULL,
    art TEXT,
    size_bytes INTEGER NOT NULL,
    completed_at INTEGER NOT NULL
  );
  CREATE INDEX downloads_completed ON downloads(completed_at DESC);
  CREATE INDEX downloads_album ON downloads(album_id);
  CREATE INDEX downloads_artist ON downloads(artist_id);

  CREATE TABLE likes (
    key TEXT PRIMARY KEY NOT NULL,
    track TEXT NOT NULL,
    liked_at INTEGER NOT NULL
  );
  CREATE INDEX likes_liked_at ON likes(liked_at DESC);

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX playlists_updated ON playlists(updated_at DESC);

  CREATE TABLE playlist_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    key TEXT NOT NULL,
    track TEXT NOT NULL
  );
  CREATE INDEX playlist_tracks_position ON playlist_tracks(playlist_id, position);
  CREATE INDEX playlist_tracks_key ON playlist_tracks(key);

  CREATE TABLE recents (
    key TEXT PRIMARY KEY NOT NULL,
    track TEXT NOT NULL,
    played_at INTEGER NOT NULL
  );
  CREATE INDEX recents_played ON recents(played_at DESC);
  `,
  // Imported playlists: cover = server path of the original's cover; import_id = server import job it mirrors.
  `
  ALTER TABLE playlists ADD COLUMN cover TEXT;
  ALTER TABLE playlists ADD COLUMN import_id TEXT;
  `,
  // Library backup: deletions the server copy has to learn about (see core/library-sync).
  `
  CREATE TABLE sync_tombstones (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
  );
  `,
  // On-device artists: ids from the accent/punctuation-insensitive artist key (the JS step below re-keys rows).
  `SELECT 1;`,
];

/** JS steps that run right after the SQL migration with the same index, in its transaction. */
const MIGRATION_STEPS: Record<number, (db: SQLiteDatabase) => Promise<void>> = {
  3: async (db) => {
    const rows = await db.getAllAsync<{ id: string; artist: string; artist_id: string }>('SELECT id, artist, artist_id FROM local_tracks');
    for (const r of rows) {
      const id = localArtistId(r.artist);
      if (id === r.artist_id) continue;
      await db.runAsync('UPDATE local_tracks SET artist_id = ? WHERE id = ?', id, r.id);
      for (const table of ['likes', 'recents', 'playlist_tracks'])
        await db.runAsync(`UPDATE ${table} SET track = json_set(track, '$.artistId', ?) WHERE key = ?`, id, `l:${r.id}`);
    }
  },
};

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync('blednify.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v];
    const next = v + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await MIGRATION_STEPS[v]?.(db);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
  }
  return db;
}

export function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Serialized write transaction. All multi-statement writes go through here so they never interleave. */
export function writeTx<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await getDb();
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  });
  writeChain = run.catch(() => undefined);
  return run;
}

/** Escape a user string for `LIKE ? ESCAPE '\'`. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
