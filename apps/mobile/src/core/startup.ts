import { resumeDownloads } from './downloads';
import { resumeImports } from './imports';
import { loadLibIndex } from './lib-index';
import { startLibrarySync } from './library-sync';
import { configureAudio, refreshQueueTracks, restoreQueue } from './player/engine';
import { fileStorageSupported } from './platform';
import { startPruning } from './prune';
import { settingsStore } from './settings';
import { syncWebSession } from './web-session';

let ready: Promise<void> | null = null;
const readyListeners: (() => void)[] = [];

/**
 * One-time, non-blocking startup: DB + migrations, library index, audio session, pending downloads.
 * Runs from the UI (CoreProvider) or headless, when Android Auto wakes the app before any screen exists.
 * Resolves once the library index is loaded (tracks resolve to downloads / the server from then on).
 */
export function startCore(): Promise<void> {
  if (ready) return ready;
  // Runs from an effect, so after the first frame: only the current song was read before it (see engine.ts).
  restoreQueue();
  void configureAudio();
  void syncWebSession();
  ready = loadLibIndex()
    .then(() => {
      refreshQueueTracks();
      startPruning();
      startLibrarySync();
      void resumeImports().catch((e) => console.warn('[core] imports resume failed', e));
      if (fileStorageSupported) void resumeDownloads().catch((e) => console.warn('[core] downloads resume failed', e));
    })
    .catch((e) => console.warn('[core] library init failed', e))
    .finally(() => readyListeners.splice(0).forEach((fn) => fn()));
  settingsStore.subscribe((s, prev) => {
    if (s.serverUrl !== prev.serverUrl || s.accessToken !== prev.accessToken) {
      void syncWebSession();
      refreshQueueTracks();
    }
  });
  return ready;
}

/** Run `fn` once startup has finished (immediately-ish if it already has). */
export function whenCoreReady(fn: () => void): void {
  if (ready) void ready.then(fn);
  else readyListeners.push(fn);
}
