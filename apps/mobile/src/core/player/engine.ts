/**
 * Playback engine.
 *
 * One long-lived native `AudioPlaylist` (ExoPlayer playlist on Android, AVQueuePlayer on iOS) holds a
 * window over the JS queue: [previous?, current, up to WINDOW_AHEAD upcoming]. Native pre-buffers the
 * next track and transitions gaplessly, and lock-screen / notification next/previous work natively even
 * while JS is throttled. The JS queue (`entries`) stays authoritative.
 *
 * IMPORTANT (Android): expo-audio's Media3 lock-screen session does not see playlist edits made after
 * it was attached; the notification's MediaController then crashes the app with
 * "Invalid PlayerInfo update" on the next transition. So auto-advance never edits the native playlist,
 * and every edit goes through `editNative`, which detaches the session, edits, and re-attaches it.
 * Edits that would happen while the app is in the background are deferred (`windowDirty`).
 */
import {
  createAudioPlaylist,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioMetadata,
  type AudioPlaylist,
  type AudioPlaylistStatus,
} from './audio';
import { AppState, Platform } from 'react-native';

import { authHeadersFor } from '../auth';
import { recordRecent } from '../library';
import { kv } from '../settings';
import { fromStorable, resolveTrack, toStorable } from '../tracks';
import type { AppTrack, PlayerState, RepeatMode } from '../types';
import { errorMessage, shuffled } from '../util';
import { lockArtwork, prefetchLockArtwork } from './lock-art';
import { playerStore, progressStore } from './store';

type Entry = { uid: number; track: AppTrack };
/** Android adds `error: { message, code }` to playlist status events; it is not in the public type. */
type NativeStatus = AudioPlaylistStatus & { error?: unknown };

const UPDATE_INTERVAL_MS = 250;
const RESTART_THRESHOLD_MS = 3_000;
const RECENT_AFTER_MS = 3_000;
const LOAD_TIMEOUT_MS = 20_000;
const MAX_ERROR_STREAK = 3;
const POSITION_SAVE_MS = 5_000;
/** How long status events reporting the pre-seek position are ignored while a seek settles. */
const SEEK_SETTLE_MS = 6_000;
const SEEK_TOLERANCE_MS = 1_500;
const QUEUE_KEY = 'player.queue.v1';
const STATE_KEY = 'player.state.v1';
const POSITION_KEY = 'player.position.v1';

// --- Queue (authoritative) -------------------------------------------------------------------

let uidSeq = 0;
const toEntry = (track: AppTrack): Entry => ({ uid: ++uidSeq, track });

let entries: Entry[] = [];
/** Unshuffled order; restored when shuffle is turned off. Same Entry objects as `entries`. */
let original: Entry[] = [];
let index = -1;

// --- Native window ---------------------------------------------------------------------------

let nat: AudioPlaylist | null = null;
let natSub: { remove(): void } | null = null;
/** Entry uid and loaded URI per native slot (URIs change when a download lands or the server moves). */
let natUids: number[] = [];
let natUris: string[] = [];
let natCur = -1;
/**
 * Native slot a JS-initiated skip is waiting for. Until native reports it, status events still describe the
 * previous song (its position especially), and publishing them would flash the old position on the new song.
 */
let advancingTo: { ci: number; until: number } | null = null;
/** Native holds the current entry and can be played without a reload. */
let natReady = false;
/** Native player hit an error and must be recreated (ExoPlayer stays idle after errors). */
let natBroken = false;
/** Ignore status events until the one emitted by `clear()` (trackCount 0) arrives. */
let awaitingClear = false;
let lockActive = false;
/** The native upcoming window differs from the queue; re-sync when it is safe (foreground). */
let windowDirty = false;
/** Upcoming tracks kept in the native playlist after the current one. */
const WINDOW_AHEAD = 200;

// --- Playback intent / bookkeeping -----------------------------------------------------------

let wantPlay = false;
let pendingSeekMs: number | null = null;
/** Target of the latest seek; progress holds there until native reports arriving (or the guard expires). */
let seekGuard: { ms: number; until: number } | null = null;
let curLoaded = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let errorStreak = 0;
let lastCommandAt = 0;
let listenedMs = 0;
let lastTimeS = 0;
let recorded = false;
let lastPositionSave = 0;

// --- Audio session ---------------------------------------------------------------------------

let audioModePromise: Promise<void> | null = null;
let audioModeSet = false;

export function configureAudio(): Promise<void> {
  audioModePromise ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMixPersistent',
    allowsRecording: false,
    shouldRouteThroughEarpiece: false,
  })
    .catch((e) => console.warn('[player] setAudioModeAsync failed', e))
    .finally(() => {
      audioModeSet = true;
    });
  return audioModePromise;
}

function startNative() {
  if (!nat) return;
  if (audioModeSet) nat.play();
  else
    void configureAudio().then(() => {
      if (wantPlay) nat?.play();
    });
}

// --- Helpers ---------------------------------------------------------------------------------

const S = () => playerStore.getState();

type Source = { uri: string; name: string; headers?: Record<string, string> };

function sourceOf(t: AppTrack): Source | null {
  const r = resolveTrack(t);
  if (!r.streamUri) return null;
  return { uri: r.streamUri, name: r.title, headers: authHeadersFor(r.streamUri) };
}

/** Identity of a loaded native source: its URI plus the credential it was loaded with. */
const srcKey = (s: Source) => `${s.uri}\n${s.headers?.Authorization ?? ''}`;

function metadataOf(t: AppTrack): AudioMetadata {
  const r = resolveTrack(t);
  const meta: AudioMetadata = { title: r.title, artist: r.artist, albumTitle: r.album };
  // The OS fetches lock-screen artwork without our headers; covers that need the token come from a local copy.
  meta.artworkUrl = lockArtwork(r.artworkUri, (local) => {
    if (lockActive && entries[index]?.track.key === t.key) nat?.updateLockScreenMetadata({ ...meta, artworkUrl: local });
  });
  const next = nextIndex();
  if (next !== null && next !== index) prefetchLockArtwork(resolveTrack(entries[next].track).artworkUri);
  return meta;
}

/** Index that follows `index` during playback; repeat-all wraps. */
function nextIndex(): number | null {
  if (!entries.length) return null;
  if (index + 1 < entries.length) return index + 1;
  return S().repeat === 'all' ? 0 : null;
}

function publishQueue(extra?: Partial<PlayerState>) {
  playerStore.setState({
    queue: entries.map((e) => e.track),
    index,
    current: entries[index]?.track ?? null,
    ...extra,
  });
  persistState();
  scheduleQueuePersist();
}

function publishIndex(extra?: Partial<PlayerState>) {
  playerStore.setState({ index, current: entries[index]?.track ?? null, ...extra });
  persistState();
}

function setProgress(positionMs: number, durationMs: number) {
  const p = progressStore.getState();
  if (Math.abs(p.positionMs - positionMs) >= 1 || Math.abs(p.durationMs - durationMs) >= 1)
    progressStore.setState({ positionMs, durationMs });
}

/** Per-track state. Also drops a seek aimed at the previous track; resumes playback it was holding back. */
function resetTrackCounters() {
  listenedMs = 0;
  lastTimeS = 0;
  recorded = false;
  curLoaded = false;
  seekGuard = null;
  if (pendingSeekMs !== null) {
    pendingSeekMs = null;
    if (wantPlay && natReady) startNative();
  }
}

function clearWatchdog() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

function armWatchdog() {
  clearWatchdog();
  if (!wantPlay || curLoaded) return;
  watchdog = setTimeout(() => {
    watchdog = null;
    if (wantPlay && !curLoaded) onPlaybackError('Track took too long to load');
  }, LOAD_TIMEOUT_MS);
}

// --- Native lifecycle ------------------------------------------------------------------------

function destroyNative() {
  if (!nat) return;
  const old = nat;
  natSub?.remove();
  natSub = null;
  nat = null;
  natReady = false;
  lockActive = false;
  try {
    old.destroy();
    old.release();
  } catch {
    // Already released natively.
  }
}

function createNative(): AudioPlaylist {
  destroyNative();
  const p = createAudioPlaylist({ updateInterval: UPDATE_INTERVAL_MS, loop: 'none' });
  natSub = p.addListener('playlistStatusUpdate', onStatus);
  nat = p;
  natUids = [];
  natUris = [];
  natCur = -1;
  natBroken = false;
  awaitingClear = false;
  applyLoop();
  return p;
}

function applyLoop() {
  if (nat) nat.loop = S().repeat === 'one' ? 'single' : 'none';
}

const NOTIF_ASKED_KEY = 'player.notificationPermissionAsked';

/** Android 13+: the media notification (and its controls) needs POST_NOTIFICATIONS. Ask once. */
function ensureNotificationPermission() {
  if (Platform.OS !== 'android' || kv.getBoolean(NOTIF_ASKED_KEY)) return;
  kv.set(NOTIF_ASKED_KEY, true);
  requestNotificationPermissionsAsync().catch((e) => console.warn('[player] notification permission', e));
}

function activateLockScreen(t: AppTrack, force = false) {
  if (!nat) return;
  ensureNotificationPermission();
  if (lockActive && !force) {
    nat.updateLockScreenMetadata(metadataOf(t));
    return;
  }
  nat.setActiveForLockScreen(true, metadataOf(t), {
    showNextTrack: true,
    showPreviousTrack: true,
    showSeekForward: false,
    showSeekBackward: false,
  });
  lockActive = true;
}

/** Run a native playlist edit with the lock-screen session detached (see header), then re-attach it. */
function editNative(edit: (n: AudioPlaylist) => void) {
  if (!nat) return;
  const reattach = lockActive;
  if (reattach) {
    nat.clearLockScreenControls();
    lockActive = false;
  }
  edit(nat);
  const cur = entries[index];
  if (reattach && cur) activateLockScreen(cur.track, true);
}

/** Upcoming playable entries that should follow the current one natively (no repeat-all wrap). */
function desiredTail(): Entry[] {
  const out: Entry[] = [];
  for (let i = index + 1; i < entries.length && out.length < WINDOW_AHEAD; i++) {
    if (!sourceOf(entries[i].track)) break;
    out.push(entries[i]);
  }
  return out;
}

/** Make the native slots after the current one equal the queue's upcoming entries. */
function syncWindow() {
  if (!nat || !natReady) return;
  // Native may have advanced before its event reached JS; catch up first.
  const live = nat.currentIndex;
  if (!advancingTo && live !== natCur && live >= 0 && live < natUids.length && nat.trackCount === natUids.length) onNativeIndex(live);
  const want = desiredTail().flatMap((e) => {
    const src = sourceOf(e.track);
    return src ? [{ uid: e.uid, src }] : [];
  });
  const haveUids = natUids.slice(natCur + 1);
  const haveKeys = natUris.slice(natCur + 1);
  if (want.length === haveUids.length && want.every((w, k) => w.uid === haveUids[k] && srcKey(w.src) === haveKeys[k])) {
    windowDirty = false;
    return;
  }
  if (lockActive && AppState.currentState !== 'active') {
    windowDirty = true;
    return;
  }
  windowDirty = false;
  editNative((n) => {
    for (let i = natUids.length - 1; i > natCur; i--) {
      n.remove(i);
      natUids.pop();
      natUris.pop();
    }
    for (const w of want) {
      n.add(w.src);
      natUids.push(w.uid);
      natUris.push(srcKey(w.src));
    }
  });
}

/**
 * (Re)load the native window around `idx`. The only path that touches the playing item, so it is used
 * for explicit jumps, never for ordinary auto-advance.
 */
function load(idx: number, play: boolean, positionMs = 0) {
  const cur = entries[idx];
  if (!cur) return stopAll();
  clearWatchdog();
  index = idx;
  pendingSeekMs = null;
  advancingTo = null;
  resetTrackCounters();
  wantPlay = play;
  lastCommandAt = Date.now();
  setProgress(positionMs, cur.track.durationMs);

  kv.set(POSITION_KEY, Math.round(positionMs));

  const src = sourceOf(cur.track);
  if (!src) {
    nat?.pause();
    publishIndex({ isPlaying: false, isBuffering: false });
    onPlaybackError(cur.track.origin === 'remote' ? 'No server configured' : 'File is missing');
    return;
  }

  const n = !nat || natBroken ? createNative() : nat;
  const reattach = lockActive;
  if (reattach) {
    n.clearLockScreenControls();
    lockActive = false;
  }
  awaitingClear = true;
  n.clear();
  natUids = [];
  natUris = [];
  const prev = entries[idx - 1];
  const prevSrc = prev ? sourceOf(prev.track) : null;
  if (prev && prevSrc) {
    n.add(prevSrc);
    natUids.push(prev.uid);
    natUris.push(srcKey(prevSrc));
  }
  n.add(src);
  natUids.push(cur.uid);
  natUris.push(srcKey(src));
  natCur = natUids.length - 1;
  for (const e of desiredTail()) {
    const s2 = sourceOf(e.track);
    if (!s2) break;
    n.add(s2);
    natUids.push(e.uid);
    natUris.push(srcKey(s2));
  }
  n.skipTo(natCur);
  // The rebuilt window starts on the previous song's slot; ignore native until it lands on ours.
  advancingTo = { ci: natCur, until: Date.now() + 2_000 };
  natReady = true;
  windowDirty = false;

  pendingSeekMs = positionMs > 0 ? positionMs : null;
  if (pendingSeekMs !== null) guardSeek(pendingSeekMs);
  publishIndex({ isPlaying: play, isBuffering: play });
  if (play) {
    activateLockScreen(cur.track);
    if (pendingSeekMs === null) startNative();
    armWatchdog();
  } else if (reattach) {
    activateLockScreen(cur.track, true);
  }
}

function stopAll() {
  clearWatchdog();
  advancingTo = null;
  wantPlay = false;
  pendingSeekMs = null;
  if (nat) {
    awaitingClear = true;
    nat.clear();
    if (lockActive) nat.clearLockScreenControls();
  }
  lockActive = false;
  natUids = [];
  natUris = [];
  natCur = -1;
  natReady = false;
  entries = [];
  original = [];
  index = -1;
  resetTrackCounters();
  progressStore.setState({ positionMs: 0, durationMs: 0 });
  publishQueue({ isPlaying: false, isBuffering: false });
}

// --- Native events ---------------------------------------------------------------------------

function onNativeIndex(ci: number) {
  const uid = natUids[ci];
  natCur = ci;
  const idx = entries.findIndex((e) => e.uid === uid);
  if (idx < 0) {
    // The entry native moved to was removed from the queue in the meantime.
    load(Math.min(Math.max(index, 0), entries.length - 1), wantPlay);
    return;
  }
  index = idx;
  resetTrackCounters();
  const t = entries[idx].track;
  setProgress(0, t.durationMs);
  kv.set(POSITION_KEY, 0);
  publishIndex();
  if (lockActive) nat?.updateLockScreenMetadata(metadataOf(t));
  // Only touch the native playlist when it is out of date or about to run dry; never routinely.
  if (windowDirty || (natCur >= natUids.length - 1 && index + 1 < entries.length)) syncWindow();
  armWatchdog();
}

function onStatus(s: NativeStatus) {
  if (awaitingClear) {
    if (s.trackCount === 0) awaitingClear = false;
    return;
  }
  // Events emitted before the latest add/remove describe a different window; skip them.
  if (s.trackCount !== natUids.length || !natReady) return;
  if (advancingTo) {
    if (s.currentIndex !== advancingTo.ci && Date.now() < advancingTo.until) return;
    advancingTo = null;
  }

  if (s.currentIndex !== natCur && s.currentIndex >= 0 && s.currentIndex < natUids.length) {
    onNativeIndex(s.currentIndex);
    if (awaitingClear || !natReady) return; // a reload happened; this event is stale now
  }

  if (s.error) {
    const e = s.error;
    onPlaybackError(typeof e === 'string' ? e : errorMessage(e));
    return;
  }
  if (s.didJustFinish) {
    onNativeFinished();
    return;
  }

  const cur = entries[index]?.track;
  if (s.isLoaded && !curLoaded) {
    curLoaded = true;
    clearWatchdog();
  }
  if (s.isLoaded && pendingSeekMs !== null) {
    const ms = pendingSeekMs;
    pendingSeekMs = null;
    void nat
      ?.seekTo(ms / 1000)
      .catch(() => undefined)
      .finally(() => {
        if (wantPlay) startNative();
      });
    return;
  }

  // External play/pause (lock screen, headset, audio focus) updates intent once settled.
  if (s.isLoaded && !s.isBuffering && pendingSeekMs === null && Date.now() - lastCommandAt > 1_000)
    wantPlay = s.playing;

  const positionMs = Math.max(0, s.currentTime * 1000);
  if (seekGuard && (Math.abs(positionMs - seekGuard.ms) < SEEK_TOLERANCE_MS || Date.now() > seekGuard.until))
    seekGuard = null;
  if (!seekGuard) setProgress(positionMs, s.duration > 0 ? s.duration * 1000 : (cur?.durationMs ?? 0));

  if (s.playing) {
    const d = s.currentTime - lastTimeS;
    if (!seekGuard && d > 0) listenedMs += Math.min(d, 5) * 1000;
    if (!recorded && listenedMs >= RECENT_AFTER_MS && cur) {
      recorded = true;
      void recordRecent(cur).catch((e) => console.warn('[player] recordRecent failed', e));
    }
    if (s.isLoaded) errorStreak = 0;
    const now = Date.now();
    if (now - lastPositionSave > POSITION_SAVE_MS) {
      lastPositionSave = now;
      kv.set(POSITION_KEY, Math.round(positionMs));
    }
  }
  lastTimeS = s.currentTime;

  const isPlaying = s.playing;
  const isBuffering = wantPlay && (s.isBuffering || !s.isLoaded);
  const st = S();
  if (st.isPlaying !== isPlaying || st.isBuffering !== isBuffering || (st.error && isPlaying && s.isLoaded))
    playerStore.setState({ isPlaying, isBuffering, ...(isPlaying && s.isLoaded ? { error: null } : null) });
}

function onNativeFinished() {
  // Native window ended. Either the queue really ended, or the next entry had no playable source.
  const ni = nextIndex();
  if (ni !== null && ni !== index) {
    load(ni, true);
    return;
  }
  wantPlay = false;
  kv.set(POSITION_KEY, 0);
  load(0, false);
}

function onPlaybackError(message: string) {
  // Auto-skip only while the user wants playback; a paused/stopped player just reports the error.
  const resume = wantPlay;
  clearWatchdog();
  natBroken = true;
  natReady = false;
  pendingSeekMs = null;
  errorStreak++;
  playerStore.setState({ error: message, errorId: S().errorId + 1, isBuffering: false });
  const ni = nextIndex();
  if (!resume || errorStreak >= Math.min(MAX_ERROR_STREAK, entries.length) || ni === null) {
    wantPlay = false;
    playerStore.setState({ isPlaying: false });
    return;
  }
  load(ni, true);
}

// --- Persistence -----------------------------------------------------------------------------
// The (potentially large) queue is written only when it changes; index/mode/position are tiny keys.

type PersistedQueue = { queue: AppTrack[]; original: number[] };
type PersistedState = { index: number; repeat: RepeatMode; shuffle: boolean };

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistState() {
  const { repeat, shuffle } = S();
  kv.set(STATE_KEY, JSON.stringify({ index, repeat, shuffle } satisfies PersistedState));
}

function scheduleQueuePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistQueueNow();
  }, 400);
}

function persistQueueNow() {
  const pos = new Map(entries.map((e, i) => [e.uid, i]));
  const data: PersistedQueue = {
    queue: entries.map((e) => toStorable(e.track)),
    original: original.map((e) => pos.get(e.uid) ?? -1).filter((i) => i >= 0),
  };
  kv.set(QUEUE_KEY, JSON.stringify(data));
}

function savePosition() {
  kv.set(POSITION_KEY, Math.round(progressStore.getState().positionMs));
}

function restore() {
  const rawQueue = kv.getString(QUEUE_KEY);
  const rawState = kv.getString(STATE_KEY);
  try {
    const st: Partial<PersistedState> = rawState ? JSON.parse(rawState) : {};
    playerStore.setState({ repeat: st.repeat ?? 'off', shuffle: !!st.shuffle });
    if (!rawQueue) return;
    const q = JSON.parse(rawQueue) as PersistedQueue;
    entries = q.queue.map((t) => toEntry(resolveTrack(fromStorable(t))));
    original = q.original.length === entries.length ? q.original.map((i) => entries[i]) : entries.slice();
    index = entries.length ? Math.min(Math.max(st.index ?? 0, 0), entries.length - 1) : -1;
    const current = entries[index]?.track ?? null;
    playerStore.setState({ queue: entries.map((e) => e.track), index, current });
    progressStore.setState({ positionMs: kv.getNumber(POSITION_KEY) ?? 0, durationMs: current?.durationMs ?? 0 });
  } catch (e) {
    console.warn('[player] could not restore queue', e);
    entries = [];
    original = [];
    index = -1;
  }
}

restore();

AppState.addEventListener('change', (state) => {
  if (state === 'active' && windowDirty) syncWindow();
  if (state !== 'active') {
    savePosition();
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
      persistQueueNow();
    }
  }
});

/** Re-resolve URIs of queued tracks (server URL changed, download finished/removed). */
export function refreshQueueTracks() {
  let changed = false;
  for (const e of entries) {
    const r = resolveTrack(e.track);
    if (r !== e.track) {
      e.track = r;
      changed = true;
    }
  }
  if (changed) publishQueue();
  // Re-checks the pre-buffered slot against the current URL and token (no-op when nothing differs).
  syncWindow();
}

/** Drop every queue entry whose track key is in `keys` (e.g. deleted local files). */
export function removeKeysFromQueue(keys: ReadonlySet<string>) {
  if (!entries.some((e) => keys.has(e.track.key))) return;
  const curUid = entries[index]?.uid;
  const curRemoved = !!entries[index] && keys.has(entries[index].track.key);
  const firstAfter = entries.slice(index).find((e) => !keys.has(e.track.key))?.uid;
  entries = entries.filter((e) => !keys.has(e.track.key));
  original = original.filter((e) => !keys.has(e.track.key));
  if (!entries.length) return stopAll();
  if (curRemoved) {
    const ni = entries.findIndex((e) => e.uid === firstAfter);
    index = ni >= 0 ? ni : 0;
    publishQueue();
    if (natReady || wantPlay) load(index, wantPlay);
    return;
  }
  index = entries.findIndex((e) => e.uid === curUid);
  publishQueue();
  syncWindow();
}

/** Replaces the info (title, artist, …) of queued tracks with newer copies; playback is untouched. */
export function updateQueueTracks(fresh: ReadonlyMap<string, AppTrack>) {
  if (!entries.some((e) => fresh.has(e.track.key))) return;
  const swap = (e: Entry): Entry => {
    const t = fresh.get(e.track.key);
    return t ? { ...e, track: t } : e;
  };
  entries = entries.map(swap);
  original = original.map(swap);
  publishQueue();
}

// --- Public imperative API -------------------------------------------------------------------

const isActive = () => wantPlay || S().isPlaying;

function play() {
  if (index < 0 || !entries[index]) return;
  errorStreak = 0;
  if (!nat || !natReady || natBroken) {
    load(index, true, progressStore.getState().positionMs);
    return;
  }
  wantPlay = true;
  lastCommandAt = Date.now();
  activateLockScreen(entries[index].track);
  startNative();
  armWatchdog();
  playerStore.setState({ isPlaying: true, error: null });
}

function pause() {
  wantPlay = false;
  lastCommandAt = Date.now();
  clearWatchdog();
  nat?.pause();
  playerStore.setState({ isPlaying: false, isBuffering: false });
  savePosition();
}

function guardSeek(ms: number) {
  seekGuard = { ms, until: Date.now() + SEEK_SETTLE_MS };
}

function seekTo(ms: number) {
  const dur = progressStore.getState().durationMs;
  const target = Math.max(0, dur > 0 ? Math.min(ms, dur) : ms);
  setProgress(target, dur);
  guardSeek(target);
  lastTimeS = target / 1000;
  if (nat && natReady && !natBroken) {
    if (curLoaded) void nat.seekTo(target / 1000).catch(() => undefined);
    else pendingSeekMs = target;
  }
  savePosition();
}

function next() {
  const ni = nextIndex();
  if (ni === null) {
    if (entries.length) {
      kv.set(POSITION_KEY, 0);
      load(0, false);
    }
    return;
  }
  const playing = isActive();
  if (nat && natReady && !natBroken && natUids[natCur + 1] === entries[ni].uid && nat.trackCount === natUids.length) {
    // Already pre-buffered natively: let native advance; `onNativeIndex` finalizes state.
    index = ni;
    advancingTo = { ci: natCur + 1, until: Date.now() + 2_000 };
    nat.next();
    resetTrackCounters();
    lastCommandAt = Date.now();
    setProgress(0, entries[ni].track.durationMs);
    publishIndex();
    return;
  }
  load(ni, playing);
}

function previous() {
  if (index < 0) return;
  const { repeat } = S();
  if (progressStore.getState().positionMs > RESTART_THRESHOLD_MS || (index === 0 && repeat !== 'all')) {
    seekTo(0);
    return;
  }
  load(index > 0 ? index - 1 : entries.length - 1, isActive());
}

function playTracks(tracks: AppTrack[], startIndex?: number, opts?: { shuffle?: boolean }) {
  if (!tracks.length) return;
  const list = tracks.map(toEntry);
  const shuffle = opts?.shuffle ?? S().shuffle;
  original = list;
  errorStreak = 0;
  if (shuffle) {
    const start = startIndex ?? Math.floor(Math.random() * list.length);
    const first = list[Math.min(Math.max(start, 0), list.length - 1)];
    entries = [first, ...shuffled(list.filter((e) => e !== first))];
    index = 0;
  } else {
    entries = list.slice();
    index = Math.min(Math.max(startIndex ?? 0, 0), list.length - 1);
  }
  publishQueue({ shuffle, error: null });
  load(index, true);
}

function playNext(tracks: AppTrack[]) {
  if (!tracks.length) return;
  if (!entries.length) return playTracks(tracks, 0);
  const add = tracks.map(toEntry);
  const cur = entries[index];
  entries = [...entries.slice(0, index + 1), ...add, ...entries.slice(index + 1)];
  const oi = original.indexOf(cur);
  original = [...original.slice(0, oi + 1), ...add, ...original.slice(oi + 1)];
  publishQueue();
  syncWindow();
}

function addToQueue(tracks: AppTrack[]) {
  if (!tracks.length) return;
  const add = tracks.map(toEntry);
  const wasEmpty = !entries.length;
  entries = [...entries, ...add];
  original = [...original, ...add];
  if (wasEmpty) {
    index = 0;
    natReady = false;
    resetTrackCounters();
    setProgress(0, entries[0].track.durationMs);
  }
  publishQueue();
  syncWindow();
}

function removeFromQueue(i: number) {
  const e = entries[i];
  if (!e) return;
  entries = entries.filter((_, j) => j !== i);
  original = original.filter((x) => x !== e);
  if (!entries.length) return stopAll();
  if (i < index) {
    index--;
    publishQueue();
    syncWindow();
  } else if (i === index) {
    index = Math.min(i, entries.length - 1);
    publishQueue();
    if (natReady) load(index, isActive());
    else setProgress(0, entries[index].track.durationMs);
  } else {
    publishQueue();
    syncWindow();
  }
}

function moveInQueue(from: number, to: number) {
  if (from === to || !entries[from] || to < 0 || to >= entries.length) return;
  const curUid = entries[index]?.uid;
  const list = entries.slice();
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  entries = list;
  // Unshuffled, `original` mirrors the visible order, so a later shuffle round-trip keeps the edit.
  if (!S().shuffle) original = list.slice();
  index = list.findIndex((e) => e.uid === curUid);
  publishQueue();
  syncWindow();
}

function jumpTo(i: number) {
  if (!entries[i]) return;
  errorStreak = 0;
  playerStore.setState({ error: null });
  load(i, true);
}

function setRepeat(mode: RepeatMode) {
  playerStore.setState({ repeat: mode });
  applyLoop();
  syncWindow();
  persistState();
}

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

function cycleRepeat() {
  setRepeat(REPEAT_CYCLE[S().repeat]);
}

function toggleShuffle() {
  const shuffle = !S().shuffle;
  const cur = entries[index];
  if (cur) {
    if (shuffle) {
      entries = [cur, ...shuffled(original.filter((e) => e !== cur))];
      index = 0;
    } else {
      entries = original.slice();
      index = Math.max(0, entries.indexOf(cur));
    }
  }
  publishQueue({ shuffle });
  syncWindow();
}

export const player = {
  playTracks,
  togglePlay: () => (isActive() ? pause() : play()),
  play,
  pause,
  next,
  previous,
  seekTo,
  playNext,
  addToQueue,
  removeFromQueue,
  moveInQueue,
  jumpTo,
  setRepeat,
  cycleRepeat,
  toggleShuffle,
};
