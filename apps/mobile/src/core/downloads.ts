import { File } from 'expo-file-system';
import { addNetworkStateListener, getNetworkStateAsync, NetworkStateType, type NetworkState } from 'expo-network';
import { useMemo } from 'react';
import { AppState } from 'react-native';
import { create, useStore } from 'zustand';

import { trackArtworkUrl, trackStreamUrl } from './api';
import { getDb, writeTx } from './db';
import { libIndex, setDownload, setDownloads, type DownloadEntry } from './lib-index';
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
const QUEUE_KEY = 'downloads.queue.v1';
const PERSIST_DEBOUNCE_MS = 1000;
const COMPLETION_BATCH_MS = 400;

type Item = { track: AppTrack; status: Exclude<DownloadStatus, 'none' | 'done'>; error?: string };
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
  const pending = order.filter((k) => items[k].status !== 'error').map((k) => serializeTrack(items[k].track));
  kv.set(QUEUE_KEY, JSON.stringify(pending));
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

function applyNetworkPolicy(net: NetworkState) {
  if (allowedOn(net)) void pump();
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
  patch(key, { status: 'downloading', error: undefined });
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
      patch(key, { status: 'error', error: errorMessage(e) });
      setProgress(key, null);
      persistQueue();
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
    nextItems[t.key] = { track: t, status: 'queued' };
    if (!existing) nextOrder.push(t.key);
    changed = true;
  }
  if (!changed) return;
  dlStore.setState({ items: nextItems, order: nextOrder });
  persistQueue();
  void pump();
}

export function cancelDownload(key: string): void {
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

/** Restore the pending queue persisted across launches and drop rows whose files vanished. */
export async function resumeDownloads(): Promise<void> {
  const raw = kv.getString(QUEUE_KEY);
  if (raw) {
    try {
      const tracks = (JSON.parse(raw) as string[]).map(parseTrack).filter((t): t is AppTrack => !!t);
      downloadTracks(tracks);
    } catch {
      kv.remove(QUEUE_KEY);
    }
  }
  const missing = [...libIndex.getState().downloads].filter(([, e]) => !fileAt(e.file).exists).map(([k]) => k);
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

export function useDownloads(): {
  active: { track: AppTrack; status: DownloadStatus }[];
  completedCount: number;
  bytesUsed: number;
} {
  const items = useStore(dlStore, (s) => s.items);
  const order = useStore(dlStore, (s) => s.order);
  const downloads = useStore(libIndex, (s) => s.downloads);
  const active = useMemo(
    () => order.map((k) => ({ track: items[k].track, status: items[k].status })),
    [items, order],
  );
  const bytesUsed = useMemo(() => {
    let n = 0;
    for (const e of downloads.values()) n += e.size;
    return n;
  }, [downloads]);
  return { active, completedCount: downloads.size, bytesUsed };
}
