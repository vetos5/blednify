import { AppState } from 'react-native';

import { ApiError, apiGet, queryString, type ApiTrack } from './api';
import { getDb, writeTx } from './db';
import { ripenGone } from './gone-grace';
import { dropQueuedDownloads, renameQueuedDownloads } from './downloads';
import { removeTrackReferences, rewriteTrackReferences } from './library';
import { libIndex, loadLibIndexAgain } from './lib-index';
import { deleteQuietly } from './paths';
import { removeKeysFromQueue, updateQueueTracks } from './player/engine';
import { playerStore } from './player/store';
import { invalidate, libKeys } from './query-client';
import { getServerBase, kv, settingsStore } from './settings';
import type { AppTrack } from './types';

const CHUNK = 200;
const MIN_INTERVAL_MS = 5 * 60_000;
// Songs the server deleted wait out GONE_GRACE_MS (gone-grace.ts); deletes made from this phone (`forgetTracks`)
// apply at once.
const GONE_SEEN_KEY = 'prune.goneSeen';

let running: Promise<number> | null = null;
let lastRun = 0;
/** Set once the server answers 404 (built before /api/tracks/gone); retried after a server change. */
let unsupportedBase: string | null = null;

/** Remote track keys the library, downloads or queue still reference. */
async function referencedRemoteKeys(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string }>(
    `SELECT key FROM likes WHERE key LIKE 'r:%'
     UNION SELECT key FROM recents WHERE key LIKE 'r:%'
     UNION SELECT key FROM playlist_tracks WHERE key LIKE 'r:%'
     UNION SELECT key FROM downloads WHERE key LIKE 'r:%'`,
  );
  const keys = new Set(rows.map((r) => r.key));
  for (const t of playerStore.getState().queue) if (t.origin === 'remote') keys.add(t.key);
  return [...keys];
}

function readGoneSeen(): Record<string, number> {
  try {
    const v = JSON.parse(kv.getString(GONE_SEEN_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Drops server tracks from likes, recents, playlists and the queue now (deleted from this phone). */
export async function forgetTracks(keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  await writeTx((db) => removeTrackReferences(db, keys));
  invalidate(libKeys.all);
  removeKeysFromQueue(new Set(keys));
  dropQueuedDownloads(keys);
}

/** Rewrites every copy of tracks whose file moved on the server to the new ids (old key -> new key). */
async function applyMoves(moves: Map<string, string>): Promise<void> {
  if (!moves.size) return;
  const orphans = await writeTx((db) => rewriteTrackReferences(db, moves));
  for (const rel of orphans) deleteQuietly(rel);
  await loadLibIndexAgain();
  renameQueuedDownloads(moves);
  invalidate(libKeys.all);
  const fresh = new Map<string, AppTrack>();
  for (const t of playerStore.getState().queue) {
    const to = moves.get(t.key);
    if (to) fresh.set(t.key, { ...t, key: to, id: to.slice(2) });
  }
  updateQueueTracks(fresh);
}

// --- Copies of server tracks (likes, playlists, recents, downloads, queue) ----------------------

/** Set once the server answers 404 (built before /api/tracks/lookup). */
let noLookupBase: string | null = null;

/** The info a stored copy carries that the server can change later (admin edits, artist merges). */
const INFO = ['title', 'artist', 'album', 'albumId', 'artistId'] as const;
type Info = Pick<AppTrack, (typeof INFO)[number]> & { edited: boolean };

const infoOf = (t: ApiTrack): Info => ({
  title: t.title,
  artist: t.artist,
  album: t.album,
  albumId: t.albumId,
  artistId: t.artistId,
  edited: t.edited ?? false,
});

/**
 * Brings the stored copies of server tracks up to date with the server's current title/artist/album and
 * artist/album ids. Returns how many tracks changed.
 */
async function refreshCopies(base: string): Promise<number> {
  if (noLookupBase === base) return 0;
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; track: string }>(
    `SELECT key, track FROM likes WHERE key LIKE 'r:%'
     UNION ALL SELECT key, track FROM recents WHERE key LIKE 'r:%'
     UNION ALL SELECT key, track FROM playlist_tracks WHERE key LIKE 'r:%'
     UNION ALL SELECT key, track FROM downloads WHERE key LIKE 'r:%'`,
  );
  const stored = new Map<string, Partial<AppTrack>>();
  for (const r of rows) {
    if (stored.has(r.key)) continue;
    try {
      stored.set(r.key, JSON.parse(r.track) as Partial<AppTrack>);
    } catch {
      // unreadable copy: leave it
    }
  }
  for (const t of playerStore.getState().queue) if (t.origin === 'remote' && !stored.has(t.key)) stored.set(t.key, t);
  const keys = [...stored.keys()];
  const changed = new Map<string, Info>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const ids = keys.slice(i, i + CHUNK).map((k) => k.slice(2));
    let items: ApiTrack[];
    try {
      items = (await apiGet<{ items: ApiTrack[] }>(base, `/api/tracks/lookup${queryString({ ids: ids.join(',') })}`)).items;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) noLookupBase = base;
      break;
    }
    for (const t of items) {
      const key = `r:${t.id}`;
      const old = stored.get(key);
      const info = infoOf(t);
      if (old && (INFO.some((f) => old[f] !== info[f]) || (old.edited ?? false) !== info.edited)) changed.set(key, info);
    }
  }
  if (!changed.size) return 0;
  await writeTx(async (tx) => {
    for (const [key, i] of changed) {
      const args = [i.title, i.artist, i.album, i.albumId, i.artistId, i.edited ? 'true' : 'false', key] as const;
      for (const table of ['likes', 'recents', 'playlist_tracks'])
        await tx.runAsync(
          `UPDATE ${table} SET track = json_set(track, '$.title', ?, '$.artist', ?, '$.album', ?, '$.albumId', ?, '$.artistId', ?, '$.edited', json(?)) WHERE key = ?`,
          ...args,
        );
      await tx.runAsync(
        `UPDATE downloads SET track = json_set(track, '$.title', ?, '$.artist', ?, '$.album', ?, '$.albumId', ?, '$.artistId', ?, '$.edited', json(?)),
           album_id = ?, artist_id = ? WHERE key = ?`,
        ...args.slice(0, 6),
        i.albumId,
        i.artistId,
        key,
      );
    }
  });
  invalidate(libKeys.all);
  const fresh = new Map<string, AppTrack>();
  for (const t of playerStore.getState().queue) {
    const i = changed.get(t.key);
    if (i) fresh.set(t.key, { ...t, ...i });
  }
  updateQueueTracks(fresh);
  return changed.size;
}

let refreshing: Promise<number> | null = null;

/** Updates stored copies of server tracks now (after an admin edit or merge); also runs with every prune. */
export function refreshTrackCopies(): Promise<number> {
  const base = getServerBase();
  if (!base) return Promise.resolve(0);
  refreshing ??= refreshCopies(base)
    .catch((e) => {
      console.warn('[refresh] failed', e);
      return 0;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function run(): Promise<number> {
  const base = getServerBase();
  if (!base) return 0;
  await refreshTrackCopies();
  if (unsupportedBase === base) return 0;
  const keys = await referencedRemoteKeys();
  const gone: string[] = [];
  const moves = new Map<string, string>();
  let complete = true;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const ids = keys.slice(i, i + CHUNK).map((k) => k.slice(2));
    try {
      const r = await apiGet<{ gone: string[]; moved?: Record<string, string> }>(
        base,
        `/api/tracks/gone${queryString({ ids: ids.join(',') })}`,
      );
      gone.push(...r.gone.map((id) => `r:${id}`));
      for (const [from, to] of Object.entries(r.moved ?? {}))
        if (typeof to === 'string' && to && to !== from) moves.set(`r:${from}`, `r:${to}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        unsupportedBase = base;
        return 0;
      }
      if (!gone.length && !moves.size) throw e;
      complete = false;
      break;
    }
  }
  await applyMoves(moves);

  // Deleted songs wait out GONE_GRACE_MS; downloaded copies stay everywhere: they play offline.
  const downloads = libIndex.getState().downloads;
  const { next, ripe } = ripenGone(readGoneSeen(), gone, (k) => downloads.has(k), Date.now(), complete);
  kv.set(GONE_SEEN_KEY, JSON.stringify(next));
  await forgetTracks(ripe);
  return ripe.length + moves.size;
}

/**
 * Follows songs the server moved (rewrites their ids) and drops songs it deleted (after GONE_GRACE_MS) from
 * likes, recents, playlists and the queue. The server only reports ids it deleted itself, so pointing the app at
 * another server never removes anything. Throttled unless `force`.
 */
export function pruneGoneTracks(force = false): Promise<number> {
  if (running) return running;
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return Promise.resolve(0);
  lastRun = Date.now();
  running = run()
    .catch((e) => {
      console.warn('[prune] failed', e);
      return 0;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

let started = false;

/** Prunes now, on return to the foreground, on a server change, and after a streamed track fails to play. */
export function startPruning(): void {
  if (started) return;
  started = true;
  void pruneGoneTracks(true);
  AppState.addEventListener('change', (s) => {
    if (s === 'active') void pruneGoneTracks();
  });
  settingsStore.subscribe((s, prev) => {
    if (s.serverUrl !== prev.serverUrl || s.accessToken !== prev.accessToken) void pruneGoneTracks(true);
  });
  playerStore.subscribe((s, prev) => {
    if (s.errorId !== prev.errorId && s.current?.origin === 'remote' && !s.current.localUri) void pruneGoneTracks(true);
  });
}
