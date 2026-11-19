import { useStore } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getDb, likePattern, writeTx } from './db';
import { libIndex, setLiked } from './lib-index';
import { absUri } from './paths';
import { invalidate, libKeys } from './query-client';
import {
  albumsFromTracks,
  artistsFromTracks,
  compareAlbumOrder,
  currentCtx,
  EMPTY_TRACKS,
  parseTrack,
  resolveTrack,
  serializeTrack,
  useResolveCtx,
  type ResolveCtx,
  useResolvedTracks,
} from './tracks';
import { removeSearchTracks, renameSearchTracks } from './search-history';
import type { AlbumView, AppTrack, ArtistView, Origin, Playlist } from './types';
import { randomId } from './util';

// ---------------------------------------------------------------------------------------------
// Row mapping

export type LocalRow = {
  id: string;
  title: string;
  artist: string;
  album: string;
  album_id: string;
  artist_id: string;
  duration_ms: number;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  genre: string | null;
  mime_type: string;
  size_bytes: number;
  file: string;
  art: string | null;
  added_at: string;
};

const LOCAL_COLS =
  'id, title, artist, album, album_id, artist_id, duration_ms, track_number, disc_number, year, genre, mime_type, size_bytes, file, art, added_at';

export function localRowToTrack(r: LocalRow): AppTrack {
  const uri = absUri(r.file);
  return {
    key: `l:${r.id}`,
    id: r.id,
    origin: 'local',
    title: r.title,
    artist: r.artist,
    album: r.album,
    albumId: r.album_id,
    artistId: r.artist_id,
    durationMs: r.duration_ms,
    trackNumber: r.track_number,
    discNumber: r.disc_number,
    year: r.year,
    genre: r.genre,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    artworkUri: r.art ? absUri(r.art) : null,
    streamUri: uri,
    localUri: uri,
    addedAt: r.added_at,
  };
}

const parseAll = (rows: readonly { track: string }[]): AppTrack[] => {
  const out: AppTrack[] = [];
  for (const r of rows) {
    const t = parseTrack(r.track);
    if (t) out.push(t);
  }
  return out;
};

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------
// Local library (imported files + downloaded remote tracks)

export async function fetchLocalLibrary(): Promise<AppTrack[]> {
  const db = await getDb();
  const locals = await db.getAllAsync<LocalRow>(`SELECT ${LOCAL_COLS} FROM local_tracks ORDER BY added_at DESC`);
  const downloads = await db.getAllAsync<{ track: string; completed_at: number }>(
    'SELECT track, completed_at FROM downloads ORDER BY completed_at DESC',
  );
  // Merge two time-sorted lists, newest first.
  const out: AppTrack[] = [];
  let i = 0;
  let j = 0;
  while (i < locals.length || j < downloads.length) {
    const lt = i < locals.length ? Date.parse(locals[i].added_at) : -Infinity;
    const dt = j < downloads.length ? downloads[j].completed_at : -Infinity;
    if (lt >= dt) out.push(localRowToTrack(locals[i++]));
    else {
      const t = parseTrack(downloads[j++].track);
      if (t) out.push(t);
    }
  }
  return out;
}

export function useLocalTracks(): AppTrack[] {
  const { data } = useQuery({ queryKey: libKeys.local, queryFn: fetchLocalLibrary, staleTime: Infinity });
  return useResolvedTracks(data);
}

export function useLocalAlbums(): AlbumView[] {
  const tracks = useLocalTracks();
  return useMemo(() => albumsFromTracks(tracks).sort((a, b) => a.title.localeCompare(b.title)), [tracks]);
}

/** Artists of imported and downloaded songs. */
export function useLocalArtists(): ArtistView[] {
  const tracks = useLocalTracks();
  return useMemo(() => artistsFromTracks(tracks), [tracks]);
}

/** Tracks of a local album (imported) or of a remote album that are downloaded (offline fallback). */
export async function fetchLocalAlbumTracks(origin: Origin, albumId: string): Promise<AppTrack[]> {
  const db = await getDb();
  const tracks =
    origin === 'local'
      ? (await db.getAllAsync<LocalRow>(`SELECT ${LOCAL_COLS} FROM local_tracks WHERE album_id = ?`, albumId)).map(
          localRowToTrack,
        )
      : parseAll(await db.getAllAsync<{ track: string }>('SELECT track FROM downloads WHERE album_id = ?', albumId));
  return tracks.sort(compareAlbumOrder);
}

export async function fetchLocalArtistTracks(origin: Origin, artistId: string): Promise<AppTrack[]> {
  const db = await getDb();
  const tracks =
    origin === 'local'
      ? (await db.getAllAsync<LocalRow>(`SELECT ${LOCAL_COLS} FROM local_tracks WHERE artist_id = ?`, artistId)).map(
          localRowToTrack,
        )
      : parseAll(await db.getAllAsync<{ track: string }>('SELECT track FROM downloads WHERE artist_id = ?', artistId));
  return tracks.sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.album.localeCompare(b.album) || compareAlbumOrder(a, b),
  );
}

export async function searchLocal(q: string, limit = 50): Promise<AppTrack[]> {
  const db = await getDb();
  const p = likePattern(q);
  const locals = await db.getAllAsync<LocalRow>(
    `SELECT ${LOCAL_COLS} FROM local_tracks
     WHERE title LIKE ?1 ESCAPE '\\' OR artist LIKE ?1 ESCAPE '\\' OR album LIKE ?1 ESCAPE '\\'
     ORDER BY title COLLATE NOCASE LIMIT ?2`,
    p,
    limit,
  );
  const downloads = await db.getAllAsync<{ track: string }>(
    `SELECT track FROM downloads
     WHERE json_extract(track, '$.title') LIKE ?1 ESCAPE '\\'
        OR json_extract(track, '$.artist') LIKE ?1 ESCAPE '\\'
        OR json_extract(track, '$.album') LIKE ?1 ESCAPE '\\'
     ORDER BY json_extract(track, '$.title') COLLATE NOCASE LIMIT ?2`,
    p,
    limit,
  );
  return [...locals.map(localRowToTrack), ...parseAll(downloads)];
}

// ---------------------------------------------------------------------------------------------
// Likes

export async function fetchLikes(): Promise<AppTrack[]> {
  const db = await getDb();
  return parseAll(await db.getAllAsync<{ track: string }>('SELECT track FROM likes ORDER BY liked_at DESC'));
}

export function useLikedTracks(): AppTrack[] {
  const { data } = useQuery({ queryKey: libKeys.likes, queryFn: fetchLikes, staleTime: Infinity });
  return useResolvedTracks(data);
}

export function useIsLiked(key: string): boolean {
  return useStore(libIndex, (s) => s.liked.has(key));
}

export async function toggleLike(track: AppTrack): Promise<void> {
  const wasLiked = libIndex.getState().liked.has(track.key);
  setLiked(track.key, !wasLiked);
  try {
    await writeTx(async (db) => {
      if (wasLiked) {
        await db.runAsync('DELETE FROM likes WHERE key = ?', track.key);
        await addTombstone(db, 'like', track.key);
      } else {
        await db.runAsync(
          'INSERT OR REPLACE INTO likes (key, track, liked_at) VALUES (?, ?, ?)',
          track.key,
          serializeTrack(track),
          Date.now(),
        );
        await clearTombstone(db, 'like', track.key);
      }
    });
  } catch (e) {
    setLiked(track.key, wasLiked);
    throw e;
  } finally {
    invalidate(libKeys.likes);
  }
}

// ---------------------------------------------------------------------------------------------
// Recently played

const RECENTS_CAP = 200;

export async function fetchRecents(limit: number): Promise<AppTrack[]> {
  const db = await getDb();
  return parseAll(
    await db.getAllAsync<{ track: string }>('SELECT track FROM recents ORDER BY played_at DESC LIMIT ?', limit),
  );
}

export function useRecentlyPlayed(limit = 20): AppTrack[] {
  const { data } = useQuery({
    queryKey: [...libKeys.recents, limit],
    queryFn: () => fetchRecents(limit),
    staleTime: Infinity,
  });
  return useResolvedTracks(data);
}

export async function recordRecent(track: AppTrack): Promise<void> {
  await writeTx(async (db) => {
    await db.runAsync(
      'INSERT OR REPLACE INTO recents (key, track, played_at) VALUES (?, ?, ?)',
      track.key,
      serializeTrack(track),
      Date.now(),
    );
    await db.runAsync(
      'DELETE FROM recents WHERE key NOT IN (SELECT key FROM recents ORDER BY played_at DESC LIMIT ?)',
      RECENTS_CAP,
    );
  });
  invalidate(libKeys.recents);
}

// ---------------------------------------------------------------------------------------------
// Playlists

type PlaylistRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  track_count: number;
  cover: string | null;
  import_id: string | null;
};
type PlaylistsData = { rows: PlaylistRow[]; art: Map<string, AppTrack[]> };

const PLAYLIST_SELECT = `SELECT p.id, p.name, p.created_at, p.updated_at, p.cover, p.import_id,
  (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS track_count
  FROM playlists p`;

export async function fetchPlaylists(): Promise<PlaylistsData> {
  const db = await getDb();
  const rows = await db.getAllAsync<PlaylistRow>(`${PLAYLIST_SELECT} ORDER BY p.updated_at DESC`);
  const artRows = await db.getAllAsync<{ playlist_id: string; track: string }>(
    `SELECT playlist_id, track FROM (
       SELECT playlist_id, track, ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY position) AS rn
       FROM playlist_tracks
     ) WHERE rn <= 16`,
  );
  const art = new Map<string, AppTrack[]>();
  for (const r of artRows) {
    const t = parseTrack(r.track);
    if (!t) continue;
    const list = art.get(r.playlist_id);
    if (list) list.push(t);
    else art.set(r.playlist_id, [t]);
  }
  return { rows, art };
}

function toPlaylist(r: PlaylistRow, tracks: readonly AppTrack[] | undefined, ctx: ResolveCtx = currentCtx()): Playlist {
  const artworkUris: string[] = [];
  // An imported playlist keeps the original's cover (served by the server) instead of a mosaic.
  if (r.cover && ctx.base) artworkUris.push(`${ctx.base}${r.cover}`);
  for (const t of artworkUris.length ? [] : (tracks ?? [])) {
    const uri = resolveTrack(t, ctx).artworkUri;
    if (uri && !artworkUris.includes(uri)) artworkUris.push(uri);
    if (artworkUris.length === 4) break;
  }
  return {
    id: r.id,
    name: r.name,
    trackCount: r.track_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    artworkUris,
    importId: r.import_id,
  };
}

const EMPTY_PLAYLISTS: Playlist[] = [];

export function usePlaylists(): Playlist[] {
  const { data } = useQuery({ queryKey: libKeys.playlists, queryFn: fetchPlaylists, staleTime: Infinity });
  const ctx = useResolveCtx();
  return useMemo(
    () => (data ? data.rows.map((r) => toPlaylist(r, data.art.get(r.id), ctx)) : EMPTY_PLAYLISTS),
    [data, ctx],
  );
}

export async function fetchPlaylist(id: string): Promise<{ row: PlaylistRow | null; tracks: AppTrack[] }> {
  const db = await getDb();
  const row = await db.getFirstAsync<PlaylistRow>(`${PLAYLIST_SELECT} WHERE p.id = ?`, id);
  if (!row) return { row: null, tracks: EMPTY_TRACKS };
  const tracks = parseAll(
    await db.getAllAsync<{ track: string }>(
      'SELECT track FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
      id,
    ),
  );
  return { row, tracks };
}

export function usePlaylist(id: string): { playlist: Playlist | null; tracks: AppTrack[] } {
  const { data } = useQuery({
    queryKey: libKeys.playlist(id),
    queryFn: () => fetchPlaylist(id),
    staleTime: Infinity,
    enabled: !!id,
  });
  const tracks = useResolvedTracks(data?.tracks);
  const playlist = useMemo(() => (data?.row ? toPlaylist(data.row, tracks) : null), [data, tracks]);
  return { playlist, tracks };
}

/** Records a deletion so the library backup removes it too instead of restoring it (see library-sync). */
export const addTombstone = (db: SQLiteDatabase, kind: 'playlist' | 'like', id: string) =>
  db.runAsync('INSERT OR REPLACE INTO sync_tombstones (kind, id, at) VALUES (?, ?, ?)', kind, id, Date.now());
const clearTombstone = (db: SQLiteDatabase, kind: 'playlist' | 'like', id: string) =>
  db.runAsync('DELETE FROM sync_tombstones WHERE kind = ? AND id = ?', kind, id);

const touch = (db: SQLiteDatabase, id: string) =>
  db.runAsync('UPDATE playlists SET updated_at = ? WHERE id = ?', nowIso(), id);

const invalidatePlaylist = (id: string) => invalidate(libKeys.playlists, libKeys.playlist(id));

export async function createPlaylist(name: string): Promise<string> {
  const id = randomId();
  const now = nowIso();
  await writeTx((db) =>
    db.runAsync(
      'INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      id,
      name.trim() || 'New playlist',
      now,
      now,
    ),
  );
  invalidate(libKeys.playlists);
  return id;
}

/** Creates the local mirror of a server import (same name and cover). */
export async function createImportedPlaylist(name: string, importId: string, cover: string | null): Promise<string> {
  const id = randomId();
  const now = nowIso();
  await writeTx((db) =>
    db.runAsync(
      'INSERT INTO playlists (id, name, created_at, updated_at, cover, import_id) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      name.trim() || 'Imported playlist',
      now,
      now,
      cover,
      importId,
    ),
  );
  invalidate(libKeys.playlists);
  return id;
}

/** The local playlist that mirrors an import job, if it still exists. */
export async function playlistForImport(importId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM playlists WHERE import_id = ?', importId);
  return row?.id ?? null;
}

/** Replaces a playlist's tracks (in order) unless they are already exactly these. */
export async function setPlaylistTracks(id: string, tracks: AppTrack[]): Promise<void> {
  const changed = await writeTx(async (db) => {
    const current = await db.getAllAsync<{ key: string }>(
      'SELECT key FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
      id,
    );
    if (current.length === tracks.length && current.every((r, i) => r.key === tracks[i]!.key)) return false;
    await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', id);
    const stmt = await db.prepareAsync(
      'INSERT INTO playlist_tracks (playlist_id, position, key, track) VALUES (?, ?, ?, ?)',
    );
    try {
      let pos = 0;
      for (const t of tracks) await stmt.executeAsync(id, pos++, t.key, serializeTrack(t));
    } finally {
      await stmt.finalizeAsync();
    }
    await touch(db, id);
    return true;
  });
  if (changed) invalidatePlaylist(id);
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await writeTx((db) => db.runAsync('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', trimmed, nowIso(), id));
  invalidatePlaylist(id);
}

export async function deletePlaylist(id: string): Promise<void> {
  await writeTx(async (db) => {
    await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', id);
    await db.runAsync('DELETE FROM playlists WHERE id = ?', id);
    await addTombstone(db, 'playlist', id);
  });
  invalidatePlaylist(id);
}

export async function addToPlaylist(id: string, tracks: AppTrack[]): Promise<void> {
  if (!tracks.length) return;
  await writeTx(async (db) => {
    const row = await db.getFirstAsync<{ n: number | null }>(
      'SELECT MAX(position) AS n FROM playlist_tracks WHERE playlist_id = ?',
      id,
    );
    let pos = (row?.n ?? -1) + 1;
    const stmt = await db.prepareAsync(
      'INSERT INTO playlist_tracks (playlist_id, position, key, track) VALUES (?, ?, ?, ?)',
    );
    try {
      for (const t of tracks) await stmt.executeAsync(id, pos++, t.key, serializeTrack(t));
    } finally {
      await stmt.finalizeAsync();
    }
    await touch(db, id);
  });
  invalidatePlaylist(id);
}

export async function removeFromPlaylist(id: string, index: number): Promise<void> {
  await writeTx(async (db) => {
    const res = await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?', id, index);
    if (!res.changes) return;
    await db.runAsync(
      'UPDATE playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ?',
      id,
      index,
    );
    await touch(db, id);
  });
  invalidatePlaylist(id);
}

/** Inserts a track at `index` (clamped to the end), shifting later tracks down. Used to undo a removal. */
export async function insertIntoPlaylist(id: string, index: number, track: AppTrack): Promise<void> {
  await writeTx(async (db) => {
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?', id);
    const at = Math.max(0, Math.min(index, row?.n ?? 0));
    await db.runAsync('UPDATE playlist_tracks SET position = position + 1 WHERE playlist_id = ? AND position >= ?', id, at);
    await db.runAsync(
      'INSERT INTO playlist_tracks (playlist_id, position, key, track) VALUES (?, ?, ?, ?)',
      id,
      at,
      track.key,
      serializeTrack(track),
    );
    await touch(db, id);
  });
  invalidatePlaylist(id);
}

export async function reorderPlaylist(id: string, from: number, to: number): Promise<void> {
  if (from === to) return;
  await writeTx(async (db) => {
    const row = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND position = ?',
      id,
      from,
    );
    const count = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?',
      id,
    );
    if (!row || !count || to < 0 || to >= count.n) return;
    if (from < to)
      await db.runAsync(
        'UPDATE playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ? AND position <= ?',
        id,
        from,
        to,
      );
    else
      await db.runAsync(
        'UPDATE playlist_tracks SET position = position + 1 WHERE playlist_id = ? AND position >= ? AND position < ?',
        id,
        to,
        from,
      );
    await db.runAsync('UPDATE playlist_tracks SET position = ? WHERE id = ?', to, row.id);
    await touch(db, id);
  });
  invalidatePlaylist(id);
}

/**
 * Points every stored copy of a server track (likes, recents, playlist entries, downloads) at the id its file has
 * now (the server found it under another path). Where the new id is already liked/recent/downloaded, the old
 * copy is dropped.
 */
export async function rewriteTrackReferences(db: SQLiteDatabase, moves: ReadonlyMap<string, string>): Promise<string[]> {
  const ids = (key: string) => [key, key.slice(2)] as const;
  /** Files of old download rows the new id already has its own copy of; the caller deletes them. */
  const orphans: string[] = [];
  for (const [from, to] of moves) {
    const [toKey, toId] = ids(to);
    const set = `track = json_set(track, '$.key', ?, '$.id', ?)`;
    const liked = await db.runAsync(`UPDATE OR IGNORE likes SET key = ?, ${set} WHERE key = ?`, toKey, toKey, toId, from);
    const dupLike = await db.runAsync('DELETE FROM likes WHERE key = ?', from);
    if (liked.changes || dupLike.changes) {
      await addTombstone(db, 'like', from);
      await clearTombstone(db, 'like', toKey);
    }
    await db.runAsync(`UPDATE OR IGNORE recents SET key = ?, ${set} WHERE key = ?`, toKey, toKey, toId, from);
    await db.runAsync('DELETE FROM recents WHERE key = ?', from);
    await db.runAsync(`UPDATE OR IGNORE downloads SET key = ?, ${set} WHERE key = ?`, toKey, toKey, toId, from);
    // The new id was downloaded already (again, after the move): the old row is a duplicate copy.
    const dup = await db.getFirstAsync<{ file: string; art: string | null }>('SELECT file, art FROM downloads WHERE key = ?', from);
    if (dup) {
      const kept = await db.getFirstAsync<{ file: string; art: string | null }>('SELECT file, art FROM downloads WHERE key = ?', toKey);
      await db.runAsync('DELETE FROM downloads WHERE key = ?', from);
      if (dup.file !== kept?.file) orphans.push(dup.file);
      if (dup.art && dup.art !== kept?.art) orphans.push(dup.art);
    }
    const affected = await db.getAllAsync<{ playlist_id: string }>(
      'SELECT DISTINCT playlist_id FROM playlist_tracks WHERE key = ?',
      from,
    );
    if (!affected.length) continue;
    await db.runAsync(`UPDATE playlist_tracks SET key = ?, ${set} WHERE key = ?`, toKey, toKey, toId, from);
    for (const { playlist_id } of affected) await touch(db, playlist_id);
  }
  renameSearchTracks(moves);
  return orphans;
}

/** Remove every library reference (likes, recents, playlist entries) to the given track keys. */
export async function removeTrackReferences(db: SQLiteDatabase, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    const unliked = await db.runAsync('DELETE FROM likes WHERE key = ?', key);
    if (unliked.changes) await addTombstone(db, 'like', key);
    await db.runAsync('DELETE FROM recents WHERE key = ?', key);
    const affected = await db.getAllAsync<{ playlist_id: string }>(
      'SELECT DISTINCT playlist_id FROM playlist_tracks WHERE key = ?',
      key,
    );
    if (!affected.length) continue;
    await db.runAsync('DELETE FROM playlist_tracks WHERE key = ?', key);
    for (const { playlist_id } of affected) {
      await db.runAsync(
        `UPDATE playlist_tracks SET position = (
           SELECT COUNT(*) FROM playlist_tracks t2
           WHERE t2.playlist_id = playlist_tracks.playlist_id AND t2.position < playlist_tracks.position
         ) WHERE playlist_id = ?`,
        playlist_id,
      );
      await touch(db, playlist_id);
    }
  }
  for (const key of keys) setLiked(key, false);
  removeSearchTracks(keys);
}
