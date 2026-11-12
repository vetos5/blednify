/**
 * Playlist imports (Spotify / SoundCloud / YouTube links). The server downloads the songs into its library; this
 * module follows the job and mirrors it as a local playlist with the same name, cover and order, filled in as
 * songs arrive. Followed job ids persist, so an import started before the app was closed still lands.
 */
import { AppState } from 'react-native';
import { create, useStore } from 'zustand';

import { adminRequest, refreshCatalog } from './admin';
import { ApiError, apiGet, type ApiTrack } from './api';
import { createImportedPlaylist, playlistForImport, setPlaylistTracks } from './library';
import { getServerBase, kv } from './settings';
import { fromApiTrack } from './tracks';

export type ImportState = 'queued' | 'resolving' | 'running' | 'done' | 'failed' | 'cancelled';
export type ImportItem = {
  title: string;
  artist: string;
  state: 'pending' | 'downloading' | 'done' | 'failed';
  track: ApiTrack | null;
  reused: boolean;
  error: string | null;
};
export type ImportJob = {
  id: string;
  url: string;
  source: 'spotify' | 'soundcloud' | 'youtube' | null;
  state: ImportState;
  name: string | null;
  description: string | null;
  owner: string | null;
  /** Artist / album the admin set for every song (older servers omit them). */
  artist?: string | null;
  album?: string | null;
  hasCover: boolean;
  warning: string | null;
  error: string | null;
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  updatedAt: string;
  items: ImportItem[];
};
/** A followed job; `playlistId` once its playlist exists. */
export type ImportEntry = { job: ImportJob; playlistId: string | null };

const K_JOBS = 'imports.jobs';
/** Jobs whose playlist was finalised: never recreated, even if the user deletes the playlist. */
const K_FINAL = 'imports.final';

const readIds = (k: string): string[] => {
  try {
    const v = JSON.parse(kv.getString(k) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const writeIds = (k: string, ids: string[]) => kv.set(k, JSON.stringify(ids.slice(-100)));

const store = create<{ entries: Record<string, ImportEntry>; order: string[] }>(() => ({ entries: {}, order: [] }));

export const isActive = (s: ImportState) => s === 'queued' || s === 'resolving' || s === 'running';
export const coverPath = (job: ImportJob) => (job.hasCover ? `/api/imports/${job.id}/cover` : null);

function put(job: ImportJob, playlistId?: string | null) {
  store.setState((s) => {
    const prev = s.entries[job.id];
    return {
      entries: { ...s.entries, [job.id]: { job, playlistId: playlistId !== undefined ? playlistId : (prev?.playlistId ?? null) } },
      order: s.order.includes(job.id) ? s.order : [job.id, ...s.order],
    };
  });
}

/** Starts an import on the server and follows it. Throws with the server's reason (bad link, no yt-dlp, …). */
export async function startImport(url: string, opts: { artist?: string; album?: string } = {}): Promise<ImportJob> {
  const body = { url: url.trim(), artist: opts.artist?.trim() || undefined, album: opts.album?.trim() || undefined };
  const job = await adminRequest<ImportJob>('POST', '/api/imports', { body, timeoutMs: 30_000 });
  writeIds(K_JOBS, [...readIds(K_JOBS).filter((id) => id !== job.id), job.id]);
  put(job);
  void poll();
  return job;
}

export async function cancelImport(id: string): Promise<void> {
  put(await adminRequest<ImportJob>('POST', `/api/imports/${id}/cancel`));
  void sync(id);
}

export async function retryImport(id: string): Promise<void> {
  writeIds(K_FINAL, readIds(K_FINAL).filter((x) => x !== id));
  put(await adminRequest<ImportJob>('POST', `/api/imports/${id}/retry`));
  void poll();
}

/** Stops showing a finished import here (its playlist and songs stay). */
export function dismissImport(id: string): void {
  writeIds(K_JOBS, readIds(K_JOBS).filter((x) => x !== id));
  store.setState((s) => {
    const { [id]: _gone, ...entries } = s.entries;
    return { entries, order: s.order.filter((x) => x !== id) };
  });
}

// ---------- playlist mirroring ----------

const syncing = new Map<string, Promise<void>>();
const lastSynced = new Map<string, string>();

/** Creates/updates the job's playlist with the songs that are done, in the original order. */
function sync(id: string): Promise<void> {
  const prev = syncing.get(id) ?? Promise.resolve();
  const next = prev.then(() => doSync(id)).catch((e) => console.warn('[imports] playlist sync failed', e));
  syncing.set(id, next);
  return next;
}

async function doSync(id: string): Promise<void> {
  const entry = store.getState().entries[id];
  if (!entry?.job.name) return;
  const { job } = entry;
  if (readIds(K_FINAL).includes(id)) return;
  const stamp = `${job.state}:${job.done}:${job.updatedAt}`;
  if (lastSynced.get(id) === stamp) return;
  const base = getServerBase();
  const tracks = job.items.flatMap((i) => (i.state === 'done' && i.track ? [fromApiTrack(i.track, base)] : []));
  let playlistId = entry.playlistId ?? (await playlistForImport(id));
  if (!playlistId && tracks.length) playlistId = await createImportedPlaylist(job.name ?? 'Imported playlist', id, coverPath(job));
  if (playlistId) {
    await setPlaylistTracks(playlistId, tracks);
    put(store.getState().entries[id]?.job ?? job, playlistId);
  }
  lastSynced.set(id, stamp);
  if (!isActive(job.state)) writeIds(K_FINAL, [...readIds(K_FINAL), id]);
}

// ---------- polling ----------

let polling = false;

async function refresh(id: string): Promise<ImportJob | null> {
  const base = getServerBase();
  try {
    const job = await apiGet<ImportJob>(base, `/api/imports/${id}`);
    const before = store.getState().entries[id]?.job;
    put(job);
    if (job.done !== before?.done) refreshCatalog();
    await sync(id);
    return job;
  } catch (e) {
    // Gone from the server (deleted, or another server configured): stop following it.
    if (e instanceof ApiError && e.status === 404) dismissImport(id);
    return null;
  }
}

/** Polls active jobs every few seconds while the app is in the foreground. */
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const active = store.getState().order.filter((id) => {
        const j = store.getState().entries[id]?.job;
        return j && isActive(j.state);
      });
      if (!active.length) break;
      if (AppState.currentState === 'active') await Promise.all(active.map(refresh));
      await new Promise((r) => setTimeout(r, 2500));
    }
  } finally {
    polling = false;
  }
}

/** Loads followed jobs at startup and resumes following unfinished ones. */
export async function resumeImports(): Promise<void> {
  const ids = readIds(K_JOBS);
  if (!ids.length || !getServerBase()) return;
  store.setState({ order: [...ids].reverse() }); // newest first; entries fill in as they load
  await Promise.all(ids.map(refresh));
  void poll();
}

AppState.addEventListener('change', (s) => {
  if (s === 'active' && store.getState().order.length) void poll();
});

export function useImports(): ImportEntry[] {
  const entries = useStore(store, (s) => s.entries);
  const order = useStore(store, (s) => s.order);
  return order.flatMap((id) => (entries[id] ? [entries[id]] : []));
}

export function useImport(id: string): ImportEntry | null {
  return useStore(store, (s) => s.entries[id] ?? null);
}
