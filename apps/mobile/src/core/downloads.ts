import { File } from 'expo-file-system';
import { addNetworkStateListener, getNetworkStateAsync, NetworkStateType, type NetworkState } from 'expo-network';
import { useMemo } from 'react';
import { AppState } from 'react-native';
import { create, useStore } from 'zustand';

import { trackArtworkUrl, trackStreamUrl } from './api';
import { getDb, writeTx } from './db';
import { libIndex, setDownload, setDownloads, type DownloadEntry } from './lib-index';
import { classifyDownloadError } from './download-errors';
import { DIRS, deleteQuietly, ensureDir, fileAt } from './paths';
import { authHeadersFor } from './auth';
import { refreshQueueTracks } from './player/engine';
import { invalidate, libKeys } from './query-client';
import { getServerBase, kv, settingsStore } from './settings';
import { parseTrack, serializeTrack } from './tracks';
import type { AppTrack, DownloadStatus } from './types';
import { errorMessage, extForMime } from './util';

const CONCURRENCY = 2;
const PROGRESS_THROTTLE_MS = 250;
/** v1: serialized tracks still to download; v2 also keeps failed ones (with their error) across launches. */
const QUEUE_KEY_V1 = 'downloads.queue.v1';
const QUEUE_KEY = 'downloads.queue.v2';
/** Automatic retries of a failed transfer (connection dropped, server restarting) before it shows as failed. */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const MISSING_CHECK_CHUNK = 50;
const PERSIST_DEBOUNCE_MS = 1000;
const COMPLETION_BATCH_MS = 400;

type Item = {
  track: AppTrack;
  status: Exclude<DownloadStatus, 'none' | 'done'>;
  error?: string;
  attempts?: number;
  /** An automatic retry is scheduled: the row says so instead of asking the user to tap retry. */
  retrying?: boolean;
  /** Failed in a way retrying can't fix (song gone from the server, token refused): only the user retries it. */
  permanent?: boolean;
};
type Persisted = { track: string; error?: string; permanent?: boolean };
type DlState = { items: Record<string, Item>; order: string[] };

const dlStore = create<DlState>(() => ({ items: {}, order: [] }));
/** Live progress (0..1) of running transfers only, keyed by track. Ticks never touch `dlStore`. */
const progressStore = create<{ p: Record<string, number> }>(() => ({ p: {} }));

function setProgress(key: string, value: number | null) {
  const { p } = progressStore.getState();
  if (value === null) {
    if (!(key in p)) return;
    const { [key]: _gone, ...rest } = p;
    progressStore.setState({ p: rest });
  } else if (p[key] !== value) progressStore.setState({ p: { ...p, [key]: value } });
}

const controllers = new Map<string, { ctrl: AbortController; requeue: boolean }>();
/** In-flight `run` per key, so `removeDownload` can wait for a cancelled run to finish cleaning up. */
const runs = new Map<string, Promise<void>>();
let running = 0;

// --- State helpers ---------------------------------------------------------------------------

function patch(key: string, p: Partial<Item>) {
  const { items } = dlStore.getState();
  const it = items[key];
  if (!it) return;
  dlStore.setState({ items: { ...items, [key]: { ...it, ...p } } });
}

/** Removes finished/cancelled keys from the queue in one store update. */
function dropMany(keys: string[]) {
  const { items, order } = dlStore.getState();
  const gone = new Set(keys.filter((k) => items[k]));
  for (const k of keys) setProgress(k, null);
  if (!gone.size) return;
  const rest = { ...items };
  for (const k of gone) delete rest[k];
  dlStore.setState({ items: rest, order: order.filter((k) => !gone.has(k)) });
  persistQueue();
}

function drop(key: string) {
  dropMany([key]);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: serialising the whole queue on every change is costly with hundreds of tracks. */
function persistQueue() {
  persistTimer ??= setTimeout(flushQueue, PERSIST_DEBOUNCE_MS);
}

function flushQueue() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  const { items, order } = dlStore.getState();
  // Failed items are kept too: they come back as failed rows (retried automatically) instead of vanishing.
  const pending: Persisted[] = order.map((k) => {
    const it = items[k];
    if (it.status !== 'error') return { track: serializeTrack(it.track) };
    return { track: serializeTrack(it.track), error: it.error ?? 'Failed', ...(it.permanent ? { permanent: true } : {}) };
  });
  kv.set(QUEUE_KEY, JSON.stringify(pending));
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Puts failed items back in the queue. `byUser`: the user asked, so permanent failures (song gone, token refused)
 * get another go too; on network regain they are left alone, since a new network can't fix them.
 */
export function retryFailedDownloads(byUser = true): void {
  const { items } = dlStore.getState();
  const failed = Object.keys(items).filter((k) => items[k].status === 'error' && (byUser || !items[k].permanent));
  if (!failed.length) return;
  const next = { ...items };
  for (const k of failed) {
    clearTimeout(retryTimers.get(k));
    retryTimers.delete(k);
    next[k] = { ...items[k], status: 'queued', error: undefined, attempts: 0, retrying: false, permanent: false };
  }
  dlStore.setState({ items: next });
  persistQueue();
  void pump();
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active') {
    flushCompletions();
    if (persistTimer) flushQueue();
  }
});

// --- Completion batching ---------------------------------------------------------------------

const completed = new Map<string, DownloadEntry>();
let completionTimer: ReturnType<typeof setTimeout> | null = null;

/** Finished downloads are applied together, so a burst re-renders lists once, not once per track. */
function completeDownload(key: string, entry: DownloadEntry) {
  completed.set(key, entry);
  completionTimer ??= setTimeout(flushCompletions, COMPLETION_BATCH_MS);
}

function flushCompletions() {
  if (completionTimer) clearTimeout(completionTimer);
  completionTimer = null;
  if (!completed.size) return;
  const batch = [...completed];
  completed.clear();
  setDownloads(batch);
  dropMany(batch.map(([k]) => k));
  refreshQueueTracks();
  invalidate(libKeys.all);
}

// --- Network policy --------------------------------------------------------------------------

const UNMETERED = new Set<NetworkStateType | undefined>([NetworkStateType.WIFI, NetworkStateType.ETHERNET]);

function allowedOn(net: NetworkState): boolean {
  if (net.isConnected === false) return false;
  return !settingsStore.getState().downloadOnWifiOnly || UNMETERED.has(net.type);
}

let netSub: { remove(): void } | null = null;

/** Stop active transfers and put them back in the queue (they resume when the policy allows). */
function requeueActive() {
  for (const entry of controllers.values()) {
    entry.requeue = true;
    entry.ctrl.abort();
  }
}

let wasAllowed = true;

function applyNetworkPolicy(net: NetworkState) {
  const allowed = allowedOn(net);
  // Back online (or on Wi-Fi again): transfers that failed meanwhile get another go.
  if (allowed && !wasAllowed) retryFailedDownloads(false);
  wasAllowed = allowed;
  if (allowed) void pump();
  else requeueActive();
}

function watchNetwork() {
  netSub ??= addNetworkStateListener(applyNetworkPolicy);
}

// --- Worker ----------------------------------------------------------------------------------

let pumping = false;
let pumpAgain = false;

async function pump(): Promise<void> {
  if (pumping) {
    pumpAgain = true;
    return;
  }
  pumping = true;
  try {
    do {
      pumpAgain = false;
      const { items, order } = dlStore.getState();
      if (running >= CONCURRENCY || !order.some((k) => items[k].status === 'queued')) break;
      if (!getServerBase()) break;
      watchNetwork();
      let net: NetworkState;
      try {
        net = await getNetworkStateAsync();
      } catch {
        net = { isConnected: true, type: NetworkStateType.UNKNOWN };
      }
      if (!allowedOn(net)) break;
      while (running < CONCURRENCY) {
        const s = dlStore.getState();
        const key = s.order.find((k) => s.items[k].status === 'queued');
        if (!key) break;
        running++;
        const r = run(key).finally(() => {
          runs.delete(key);
          running--;
          void pump();
        });
        runs.set(key, r);
      }
    } while (pumpAgain);
  } finally {
    pumping = false;
  }
}

async function run(key: string): Promise<void> {
  const item = dlStore.getState().items[key];
  if (!item) return;
  const { track } = item;
  const base = getServerBase();
  const ctrl = new AbortController();
  const handle = { ctrl, requeue: false };
  controllers.set(key, handle);
  patch(key, { status: 'downloading', error: undefined, retrying: false, permanent: false });
  setProgress(key, 0);

  const dir = ensureDir(DIRS.music);
  const fileRel = `${DIRS.music}/${track.id}.${extForMime(track.mimeType)}`;
  const artRel = `${DIRS.music}/${track.id}.jpg`;
  const part = new File(dir, `${track.id}.part`);
  let lastTick = 0;
  // A network-policy abort (`requeue`) after the audio landed is ignored: finishing is cheaper than refetching.
  const cancelled = () => ctrl.signal.aborted && !handle.requeue;
  const bail = () => {
    if (cancelled()) throw new Error('Download cancelled');
  };

  try {
    const streamUrl = trackStreamUrl(base, track.id);
    await File.downloadFileAsync(streamUrl, part, {
      headers: authHeadersFor(streamUrl),
      idempotent: true,
      signal: ctrl.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const now = Date.now();
        if (now - lastTick < PROGRESS_THROTTLE_MS) return;
        lastTick = now;
        const total = totalBytes > 0 ? totalBytes : track.sizeBytes;
        if (total > 0) setProgress(key, Math.min(0.99, bytesWritten / total));
      },
    });
    bail();
    const final = fileAt(fileRel);
    await part.move(final, { overwrite: true });
    bail();

    let art: string | null = null;
    if (track.artworkUri) {
      try {
        const artUrl = `${trackArtworkUrl(base, track.id)}?size=512`;
        await File.downloadFileAsync(artUrl, fileAt(artRel), {
          headers: authHeadersFor(artUrl),
          idempotent: true,
          signal: ctrl.signal,
        });
        art = artRel;
      } catch (e) {
        deleteQuietly(artRel);
        if (cancelled()) throw e;
        // Otherwise artwork is optional; the remote URL remains the fallback.
      }
    }
    bail();

    const size = final.size || track.sizeBytes;
    await writeTx((db) =>
      db.runAsync(
        `INSERT OR REPLACE INTO downloads (key, track, album_id, artist_id, file, art, size_bytes, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        key,
        serializeTrack(track),
        track.albumId,
        track.artistId,
        fileRel,
        art,
        size,
        Date.now(),
      ),
    );
    if (cancelled()) {
      await writeTx((db) => db.runAsync('DELETE FROM downloads WHERE key = ?', key));
      bail();
    }
    completeDownload(key, { file: fileRel, art, size });
  } catch (e) {
    deleteQuietly(`${DIRS.music}/${track.id}.part`);
    if (cancelled()) {
      // Never committed: drop whatever reached its final location.
      deleteQuietly(fileRel);
      deleteQuietly(artRel);
    }
    if (ctrl.signal.aborted) {
      if (handle.requeue) {
        patch(key, { status: 'queued' });
        setProgress(key, null);
      }
      // Cancelled: the item was already removed by `cancelDownload`.
    } else {
      const attempts = (dlStore.getState().items[key]?.attempts ?? 0) + 1;
      const { permanent, message } = classifyDownloadError(errorMessage(e));
      // Most failures are a dropped connection or a server restart: retry a few times with backoff.
      const delay = permanent ? undefined : RETRY_DELAYS_MS[attempts - 1];
      patch(key, {
        status: 'error',
        error: message,
        attempts,
        retrying: delay !== undefined,
        permanent,
      });
      setProgress(key, null);
      persistQueue();
      if (delay !== undefined) {
        clearTimeout(retryTimers.get(key));
        retryTimers.set(
          key,
          setTimeout(() => {
            retryTimers.delete(key);
            if (dlStore.getState().items[key]?.status !== 'error') return;
            patch(key, { status: 'queued', error: undefined, retrying: false });
            persistQueue();
            void pump();
          }, delay),
        );
      }
    }
  } finally {
    controllers.delete(key);
  }
}

// --- Public API ------------------------------------------------------------------------------

/** Queue remote tracks for offline use. Local and already-downloaded tracks are ignored; failed ones retry. */
export function downloadTracks(tracks: AppTrack[]): void {
  const { downloads } = libIndex.getState();
  const { items, order } = dlStore.getState();
  const nextItems = { ...items };
  const nextOrder = order.slice();
  let changed = false;
  for (const t of tracks) {
    if (t.origin !== 'remote' || downloads.has(t.key)) continue;
    const existing = nextItems[t.key];
    if (existing && existing.status !== 'error') continue;
    if (existing) {
      clearTimeout(retryTimers.get(t.key));
      retryTimers.delete(t.key);
    }
    nextItems[t.key] = { track: t, status: 'queued' };
    if (!existing) nextOrder.push(t.key);
    changed = true;
  }
  if (!changed) return;
  dlStore.setState({ items: nextItems, order: nextOrder });
  persistQueue();
  void pump();
}

function restoreFailed(failed: { track: AppTrack; error?: string }[]): void {
  const { downloads } = libIndex.getState();
  const { items, order } = dlStore.getState();
  const nextItems = { ...items };
  const nextOrder = order.slice();
  for (const { track, error } of failed) {
    if (downloads.has(track.key) || nextItems[track.key]) continue;
    nextItems[track.key] = { track, status: 'error', error: error ?? 'Failed', permanent: true };
    nextOrder.push(track.key);
  }
  if (nextOrder.length !== order.length) dlStore.setState({ items: nextItems, order: nextOrder });
}

export function cancelDownload(key: string): void {
  clearTimeout(retryTimers.get(key));
  retryTimers.delete(key);
  const active = controllers.get(key);
  drop(key);
  if (active) {
    active.requeue = false;
    active.ctrl.abort();
  }
}

export async function removeDownload(key: string): Promise<void> {
  const inFlight = runs.get(key);
  cancelDownload(key);
  // A run that was past its transfer may still commit or clean up; settle it before reading the index.
  await inFlight;
  flushCompletions();
  const entry = libIndex.getState().downloads.get(key);
  if (!entry) return;
  await writeTx((db) => db.runAsync('DELETE FROM downloads WHERE key = ?', key));
  setDownload(key, null);
  deleteQuietly(entry.file);
  deleteQuietly(entry.art);
  refreshQueueTracks();
  invalidate(libKeys.all);
}

/** Drops queued and failed downloads of songs removed from the library (deleted from the server). */
export function dropQueuedDownloads(keys: readonly string[]): void {
  for (const k of keys) if (dlStore.getState().items[k]?.status !== 'downloading') cancelDownload(k);
}

/**
 * Follows songs the server moved (old key -> new key): waiting and failed downloads switch to the new id and get a
 * fresh try, instead of asking for the old id (404) forever. A running transfer finishes under its old key; the
 * next prune moves its row.
 */
export function renameQueuedDownloads(moves: ReadonlyMap<string, string>): void {
  const { items, order } = dlStore.getState();
  const { downloads } = libIndex.getState();
  const nextItems = { ...items };
  const nextOrder: string[] = [];
  let changed = false;
  for (const k of order) {
    const to = moves.get(k);
    const it = items[k];
    if (!to || it.status === 'downloading') {
      nextOrder.push(k);
      continue;
    }
    changed = true;
    clearTimeout(retryTimers.get(k));
    retryTimers.delete(k);
    delete nextItems[k];
    if (nextItems[to] || downloads.has(to)) continue;
    nextItems[to] = { track: { ...it.track, key: to, id: to.slice(2) }, status: 'queued' };
    nextOrder.push(to);
  }
  if (!changed) return;
  dlStore.setState({ items: nextItems, order: nextOrder });
  persistQueue();
  void pump();
}

/** Clears every failed download from the list (they stay failed songs, not downloads). */
export function clearFailedDownloads(): void {
  const { items } = dlStore.getState();
  for (const k of Object.keys(items)) if (items[k].status === 'error') cancelDownload(k);
}

/**
 * Restore the queue persisted across launches and drop rows whose files vanished. Failed items get a fresh round
 * of retries, except permanent failures (song gone, token refused): those come back as failed rows the user can
 * retry or dismiss.
 */
export async function resumeDownloads(): Promise<void> {
  const raw = kv.getString(QUEUE_KEY) ?? kv.getString(QUEUE_KEY_V1);
  if (raw) {
    try {
      const saved = (JSON.parse(raw) as (string | Persisted)[]).map((p) => (typeof p === 'string' ? { track: p } : p));
      const parsed = saved.map((p) => ({ p, t: parseTrack(p.track) })).filter((x): x is { p: Persisted; t: AppTrack } => !!x.t);
      downloadTracks(parsed.filter((x) => !x.p.permanent).map((x) => x.t));
      restoreFailed(parsed.filter((x) => x.p.permanent).map((x) => ({ track: x.t, error: x.p.error })));
    } catch {
      kv.remove(QUEUE_KEY);
    }
    kv.remove(QUEUE_KEY_V1);
  }
  // File checks are synchronous native calls: in chunks, yielding between them, so startup stays responsive.
  const entries = [...libIndex.getState().downloads];
  const missing: string[] = [];
  for (let i = 0; i < entries.length; i += MISSING_CHECK_CHUNK) {
    if (i) await new Promise((r) => setTimeout(r, 0));
    for (const [k, e] of entries.slice(i, i + MISSING_CHECK_CHUNK)) if (!fileAt(e.file).exists) missing.push(k);
  }
  if (!missing.length) return;
  const db = await getDb();
  for (const key of missing) {
    await db.runAsync('DELETE FROM downloads WHERE key = ?', key);
    setDownload(key, null);
  }
  refreshQueueTracks();
  invalidate(libKeys.all);
}

// Downloads waiting on the Wi-Fi-only policy start as soon as the setting is relaxed.
// Turning Wi-Fi-only on while on mobile data also stops the transfers already running.
settingsStore.subscribe((s, prev) => {
  if (s.downloadOnWifiOnly !== prev.downloadOnWifiOnly && controllers.size)
    void getNetworkStateAsync()
      .then(applyNetworkPolicy)
      .catch(() => undefined);
  else if (s.downloadOnWifiOnly !== prev.downloadOnWifiOnly || s.serverUrl !== prev.serverUrl) void pump();
});

// --- Hooks -----------------------------------------------------------------------------------

/** Progress of one track; only its own row re-renders on a tick. */
export function useDownloadProgress(key: string): number {
  return useStore(progressStore, (s) => s.p[key] ?? 0);
}

export function useDownloadState(key: string): { status: DownloadStatus; progress: number } {
  const done = useStore(libIndex, (s) => s.downloads.has(key));
  const status = useStore(dlStore, (s) => s.items[key]?.status);
  const progress = useStore(progressStore, (s) => s.p[key] ?? 0);
  if (done) return { status: 'done', progress: 1 };
  return { status: status ?? 'none', progress };
}

export type ActiveDownload = { track: AppTrack; status: DownloadStatus; error?: string; retrying: boolean };

export function useDownloads(): {
  active: ActiveDownload[];
  completedCount: number;
  bytesUsed: number;
} {
  const items = useStore(dlStore, (s) => s.items);
  const order = useStore(dlStore, (s) => s.order);
  const downloads = useStore(libIndex, (s) => s.downloads);
  const active = useMemo(
    () =>
      order.map((k) => {
        const it = items[k];
        return { track: it.track, status: it.status, error: it.error, retrying: it.retrying === true };
      }),
    [items, order],
  );
  const bytesUsed = useMemo(() => {
    let n = 0;
    for (const e of downloads.values()) n += e.size;
    return n;
  }, [downloads]);
  return { active, completedCount: downloads.size, bytesUsed };
}
