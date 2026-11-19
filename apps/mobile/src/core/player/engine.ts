/**
 * Playback engine.
 *
 * One long-lived native `AudioPlaylist` (ExoPlayer playlist on Android, AVQueuePlayer on iOS) holds a
 * small window over the JS queue: [previous?, current, WINDOW_MIN..WINDOW_AHEAD upcoming]. Native
 * pre-buffers the next track and transitions gaplessly, and lock-screen / notification next/previous work
 * natively even while JS is throttled: when JS gets to run after an advance, native still holds at least
 * WINDOW_MIN - 1 upcoming tracks. Each advance tops the window back up (`syncWindow`), a slot whose source
 * changed (a download landed) is replaced on its own, and already-played slots are trimmed now and then.
 * The JS queue (`entries`) stays authoritative.
 *
 * IMPORTANT (Android): expo-audio's Media3 lock-screen session must not observe playlist edits (the
 * notification's MediaController then crashed the app with "Invalid PlayerInfo update"). So auto-advance never
 * edits the native playlist, and every edit is one `editPlaylist` call: the patched native side points the
 * session away from the player, applies all edits and points it back, in a single main-thread task. Media keys
 * and notification buttons are main-thread tasks too, so none can land mid-edit and be refused, and the session
 * itself is never torn down (doing that per edit dropped or misrouted lock-screen "next" presses).
 * In the background only edits needed to keep playback going (topping up a window that is running low)
 * are made; the rest wait for the foreground (`windowDirty`).
 *
 * Skips native can't serve itself (next on the last loaded slot, previous on the first) come back as a
 * `remoteSkip` event and are handled like the in-app buttons.
 */
import {
  addRemoteSkipListener,
  createAudioPlaylist,
  editPlaylist,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioMetadata,
  type AudioPlaylist,
  type AudioPlaylistStatus,
  type PlaylistEdit,
} from './audio';
import { addNetworkStateListener } from 'expo-network';
import { AppState, Platform } from 'react-native';

import { authHeadersFor } from '../auth';
import { recordRecent } from '../library';
import { kv } from '../settings';
import { fromStorable, resolveTrack } from '../tracks';
import type { AppTrack, PlayerState, RepeatMode } from '../types';
import { errorMessage, shuffled } from '../util';
import { lockArtwork, prefetchLockArtwork } from './lock-art';
import { fromRow, toRow, type QueueRow } from './queue-rows';
import { playerStore, progressStore } from './store';

type Entry = { uid: number; track: AppTrack };
/**
 * Android adds `error: { message, code }` to playlist status events; it is not in the public type. The web
 * player sends `error` as a string and flags connection failures with `network`.
 */
type NativeStatus = AudioPlaylistStatus & { error?: unknown; network?: boolean };

const UPDATE_INTERVAL_MS = 250;
const RESTART_THRESHOLD_MS = 3_000;
const RECENT_AFTER_MS = 3_000;
const LOAD_TIMEOUT_MS = 20_000;
/**
 * A play or load that hasn't started playing after this long is retried once, quietly, in a fresh native player
 * (see `armWatchdog`); LOAD_TIMEOUT_MS applies after that.
 */
const STALL_MS = 8_000;
const MAX_ERROR_STREAK = 3;
const POSITION_SAVE_MS = 5_000;
/** Retry delays after a connection error; the last one repeats until NETWORK_GIVE_UP_MS has passed. */
const NETWORK_RETRY_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const NETWORK_GIVE_UP_MS = 10 * 60_000;
/** Media3 PlaybackException codes for a connection that failed or timed out (not 4xx/5xx or bad files). */
const NETWORK_ERROR_CODES = new Set([2000, 2001, 2002]);
/**
 * HTTP statuses that say "try again" rather than "this track is broken": a proxy or tunnel that lost the server
 * (Cloudflare answers 502/530 while its tunnel reconnects), an overloaded server, a timeout.
 */
const isTransientHttpStatus = (status: number) =>
  status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);
/** How long status events reporting the pre-seek position are ignored while a seek settles. */
const SEEK_SETTLE_MS = 6_000;
const SEEK_TOLERANCE_MS = 1_500;
/** Compact rows (see queue-rows.ts). */
const QUEUE_KEY = 'player.queue.v2';
/** Full track JSON, written before v2; migrated on first restore. */
const LEGACY_QUEUE_KEY = 'player.queue.v1';
/** The queue is saved this long after the last edit (at most QUEUE_SAVE_MAX_WAIT_MS after the first). */
const QUEUE_SAVE_DEBOUNCE_MS = 1_500;
const QUEUE_SAVE_MAX_WAIT_MS = 10_000;
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
let natSkipSub: { remove(): void } | null = null;
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
/** The native player must be recreated before the next load (see `onPlaybackError`). */
let natBroken = false;
/** Ignore status events until the one emitted by `clear()` (trackCount 0) arrives. */
let awaitingClear = false;
let lockActive = false;
/** The native upcoming window differs from the queue; re-sync when it is safe (foreground). */
let windowDirty = false;
/** Upcoming tracks the native playlist is filled up to after the current one. */
const WINDOW_AHEAD = 5;
/**
 * Top up once fewer than this many upcoming tracks are left natively. With 5/3 the playlist is edited once every
 * three songs, and native still has two songs queued when it advances before JS has had a chance to run.
 */
const WINDOW_MIN = 3;
/** Played slots kept before the current one (native "previous"); more than TRIM_BEHIND are trimmed. */
const KEEP_BEHIND = 1;
/** Must stay above WINDOW_AHEAD (see `syncWindow`, stale status events). */
const TRIM_BEHIND = 8;

// --- Playback intent / bookkeeping -----------------------------------------------------------

let wantPlay = false;
let pendingSeekMs: number | null = null;
/** Target of the latest seek; progress holds there until native reports arriving (or the guard expires). */
let seekGuard: { ms: number; until: number } | null = null;
let curLoaded = false;
/** Native has reported playing (loaded) since the last load or play; until then the watchdog runs. */
let started = false;
/** Playback errors since native last played; the second one recreates the player (see `onPlaybackError`). */
let errorsSincePlaying = 0;
/** Entry whose stalled start already got its quiet retry in a fresh player. */
let quietRetryUid: number | null = null;
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
  started = false;
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

/**
 * Watches a load or play until native reports playing. A player can wedge without reporting an error: after a
 * Bluetooth headset vanished mid-song (battery died), every later load in that player hung until the timeout, and
 * the fresh player made for the retry started at once. So the first stall on a song is retried quietly, after
 * STALL_MS, in a new player at the same position; a second one is reported and handled like a dropped connection.
 */
function armWatchdog() {
  clearWatchdog();
  if (!wantPlay || started) return;
  const uid = entries[index]?.uid;
  const quiet = uid !== undefined && quietRetryUid !== uid;
  watchdog = setTimeout(
    () => {
      watchdog = null;
      if (!wantPlay || started || entries[index]?.uid !== uid) return;
      if (quiet) {
        quietRetryUid = uid;
        natBroken = true;
        load(index, true, progressStore.getState().positionMs);
        return;
      }
      // Usually a connection that stalls without failing outright; treat it like one rather than skipping.
      onPlaybackError(curLoaded ? 'Playback stalled' : 'Track took too long to load', true, true);
    },
    quiet ? STALL_MS : LOAD_TIMEOUT_MS,
  );
}

// --- Native lifecycle ------------------------------------------------------------------------

function destroyNative() {
  if (!nat) return;
  const old = nat;
  natSub?.remove();
  natSub = null;
  natSkipSub?.remove();
  natSkipSub = null;
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
  natSkipSub = addRemoteSkipListener(p, (direction) => (direction === 'next' ? player.next() : player.previous()));
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

/**
 * Apply native playlist edits in one call (see header). The lock-screen session stays attached; its metadata is
 * refreshed to the current entry. Update the JS mirror (`natUids`/`natUris`/`natCur`) BEFORE calling this: on web,
 * status events fire synchronously mid-edit, and the track-count check in `onStatus` must already see the final
 * count to drop them.
 */
function editNative(edits: PlaylistEdit[]) {
  if (!nat || !edits.length) return;
  const cur = entries[index];
  editPlaylist(nat, edits, lockActive && cur ? metadataOf(cur.track) : null);
}

/**
 * Bring JS up to date with the slot native is on right now. Native moves on its own (auto-advance, lock-screen /
 * media-key skips) and its status events reach JS later, so a decision based on `natCur` alone can be one press
 * behind. Also drops `advancingTo` when native has moved past the slot a JS skip was waiting for.
 */
function catchUpNative() {
  if (!nat || !natReady || natBroken) return;
  if (nat.trackCount !== natUids.length) return;
  const live = nat.currentIndex;
  if (live < 0 || live >= natUids.length || live === (advancingTo?.ci ?? natCur)) return;
  advancingTo = null;
  onNativeIndex(live);
}

type Slot = { uid: number; src: Source; key: string };

/** Upcoming playable entries that may follow the current one natively (no repeat-all wrap), up to WINDOW_AHEAD. */
function desiredTail(): Slot[] {
  const out: Slot[] = [];
  for (let i = index + 1; i < entries.length && out.length < WINDOW_AHEAD; i++) {
    const src = sourceOf(entries[i].track);
    if (!src) break;
    out.push({ uid: entries[i].uid, src, key: srcKey(src) });
  }
  return out;
}

/**
 * Bring the native slots after the current one in line with the queue, with as few native calls as possible:
 * a slot whose source changed (download landed, new server URL or token) is replaced in place, slots after the
 * first entry that differs are removed and re-added, and the window is topped up to WINDOW_AHEAD once fewer than
 * WINDOW_MIN upcoming tracks are left. A no-op when native already matches, the usual case after an advance.
 */
function syncWindow() {
  if (!nat || !natReady) return;
  // Native may have advanced before its event reached JS; catch up first.
  catchUpNative();
  if (!nat || !natReady) return;
  // After a JS-initiated skip native is already on `advancingTo.ci`, even though its event hasn't arrived yet.
  const curSlot = advancingTo?.ci ?? natCur;
  if (curSlot < 0 || curSlot >= natUids.length) return;
  const want = desiredTail();
  const haveUids = natUids.slice(curSlot + 1);
  const haveKeys = natUris.slice(curSlot + 1);
  let same = 0;
  while (same < want.length && same < haveUids.length && want[same].uid === haveUids[same]) same++;
  const replace: number[] = [];
  for (let k = 0; k < same; k++) if (want[k].key !== haveKeys[k]) replace.push(k);
  const drop = haveUids.length - same;
  const low = same < Math.min(want.length, WINDOW_MIN);
  // Fill up whenever the playlist is edited anyway, so edits stay rare.
  const add = low || drop > 0 || replace.length > 0 ? want.slice(same) : [];
  if (!replace.length && !drop && !add.length) {
    windowDirty = false;
    return;
  }
  // In the background, edit only when native is about to run out of the right songs (see header).
  if (!low && lockActive && AppState.currentState !== 'active') {
    windowDirty = true;
    return;
  }
  windowDirty = false;
  // Trimming shifts native indices. It is only done when it removes more slots than are added (TRIM_BEHIND >
  // WINDOW_AHEAD), so no status event from before or during this edit has the final track count, and the
  // `trackCount` check in `onStatus` drops all of them.
  const trim = !advancingTo && curSlot > TRIM_BEHIND ? curSlot - KEEP_BEHIND : 0;
  // The JS mirror first, then native in one call (see `editNative`).
  const edits: PlaylistEdit[] = [];
  for (const k of replace) {
    const slot = curSlot + 1 + k;
    edits.push({ op: 'insert', index: slot, source: want[k].src }, { op: 'remove', index: slot + 1 });
    natUris[slot] = want[k].key;
  }
  for (let i = natUids.length - 1; i > curSlot + same; i--) {
    edits.push({ op: 'remove', index: i });
    natUids.pop();
    natUris.pop();
  }
  for (const w of add) {
    edits.push({ op: 'add', source: w.src });
    natUids.push(w.uid);
    natUris.push(w.key);
  }
  for (let k = 0; k < trim; k++) {
    edits.push({ op: 'remove', index: 0 });
    natUids.shift();
    natUris.shift();
    natCur--;
  }
  editNative(edits);
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
  // One native call (see `editNative`); the JS mirror is set first.
  const edits: PlaylistEdit[] = [{ op: 'clear' }];
  natUids = [];
  natUris = [];
  const prev = entries[idx - 1];
  const prevSrc = prev ? sourceOf(prev.track) : null;
  if (prev && prevSrc) {
    edits.push({ op: 'add', source: prevSrc });
    natUids.push(prev.uid);
    natUris.push(srcKey(prevSrc));
  }
  edits.push({ op: 'add', source: src });
  natUids.push(cur.uid);
  natUris.push(srcKey(src));
  natCur = natUids.length - 1;
  for (const w of desiredTail()) {
    edits.push({ op: 'add', source: w.src });
    natUids.push(w.uid);
    natUris.push(w.key);
  }
  edits.push({ op: 'skipTo', index: natCur });
  // The rebuilt window starts on the previous song's slot; ignore native until it lands on ours.
  advancingTo = { ci: natCur, until: Date.now() + 2_000 };
  natReady = true;
  windowDirty = false;
  awaitingClear = true;
  editNative(edits);

  pendingSeekMs = positionMs > 0 ? positionMs : null;
  if (pendingSeekMs !== null) guardSeek(pendingSeekMs);
  if (pendingSeekMs !== null && Platform.OS === 'web') {
    // The web backend applies a seek once metadata arrives, so play() can run now, inside the user's tap.
    void n.seekTo(pendingSeekMs / 1000);
    pendingSeekMs = null;
  }
  publishIndex({ isPlaying: play, isBuffering: play });
  if (play) {
    // Attached already: `editNative` refreshed its metadata.
    if (!lockActive) activateLockScreen(cur.track);
    if (pendingSeekMs === null) startNative();
    armWatchdog();
  }
}

function stopAll() {
  clearWatchdog();
  cancelNetworkRetry();
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
  // `next()` already moved JS to this entry and reset its counters; a seek made since then targets this song.
  const expected = idx === index;
  index = idx;
  const t = entries[idx].track;
  if (!expected) {
    resetTrackCounters();
    setProgress(0, t.durationMs);
    kv.set(POSITION_KEY, 0);
  }
  publishIndex();
  if (lockActive) nat?.updateLockScreenMetadata(metadataOf(t));
  // Top up the window (a no-op until it runs low or is out of date).
  syncWindow();
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
    // Act on where native is now, not on this event: it may predate later skips (a burst of media-key presses),
    // and taking its slot would move JS back a song.
    catchUpNative();
    if (awaitingClear || !natReady) return; // a reload happened; this event is stale now
    if (s.currentIndex !== natCur) return; // stale: its position and state describe another slot
  }

  if (s.error) {
    const e = s.error;
    const network = s.network === true || isNetworkError(e);
    onPlaybackError(network ? "Can't reach the server" : typeof e === 'string' ? e : errorMessage(e), network);
    return;
  }
  if (s.didJustFinish) {
    onNativeFinished();
    return;
  }

  const cur = entries[index]?.track;
  if (s.isLoaded && !curLoaded) curLoaded = true;
  if (s.isLoaded && s.playing && !started) {
    started = true;
    errorsSincePlaying = 0;
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

  // Native reports the window's end once (`didJustFinish`); later events only say "loaded, not playing, at the
  // end". If that one event was dropped (it arrived mid-edit or mid-skip), finish here instead of reading it as
  // a pause below, which left playback stopped for good.
  if (
    wantPlay &&
    started &&
    s.isLoaded &&
    !s.playing &&
    !s.isBuffering &&
    natCur === natUids.length - 1 &&
    s.duration > 0 &&
    s.currentTime >= s.duration - 0.3
  ) {
    onNativeFinished();
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
    if (s.isLoaded) {
      errorStreak = 0;
      if (netRetry) {
        cancelNetworkRetry();
        playerStore.setState({ error: null });
      }
    }
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
  // `ni === index` is repeat-all over a one-song queue: play it again.
  if (ni !== null) {
    load(ni, true);
    return;
  }
  wantPlay = false;
  kv.set(POSITION_KEY, 0);
  load(0, false);
}

/** Android errors carry `{ code, httpStatus }` (see the expo-audio patch). */
function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, httpStatus } = e as { code?: unknown; httpStatus?: unknown };
  return NETWORK_ERROR_CODES.has(Number(code)) || (typeof httpStatus === 'number' && isTransientHttpStatus(httpStatus));
}

// --- Connection loss -------------------------------------------------------------------------
// A dropped connection is not the song's fault: skipping would fail on every following song too and lose the
// place in this one. Stay on it and reload from the same position until the network is back.

let netRetry: { uid: number; attempt: number; since: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
let netRetrySub: { remove(): void } | null = null;

function cancelNetworkRetry() {
  if (netRetry?.timer) clearTimeout(netRetry.timer);
  netRetry = null;
  netRetrySub?.remove();
  netRetrySub = null;
}

function retryAfterNetworkError() {
  const r = netRetry;
  const cur = entries[index];
  if (!r || !cur || cur.uid !== r.uid || !wantPlay) return cancelNetworkRetry();
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
  r.attempt++;
  load(index, true, progressStore.getState().positionMs);
}

function waitForNetwork(message: string) {
  const cur = entries[index];
  if (!cur) return;
  if (!netRetry || netRetry.uid !== cur.uid) {
    cancelNetworkRetry();
    netRetry = { uid: cur.uid, attempt: 0, since: Date.now(), timer: null };
    // Only the first failure is announced; retries stay quiet until one works or we give up.
    playerStore.setState({ error: `${message}. Retrying…`, errorId: S().errorId + 1 });
  }
  const r = netRetry;
  if (Date.now() - r.since > NETWORK_GIVE_UP_MS) {
    cancelNetworkRetry();
    wantPlay = false;
    playerStore.setState({ isPlaying: false, isBuffering: false, error: message, errorId: S().errorId + 1 });
    return;
  }
  playerStore.setState({ isPlaying: false, isBuffering: true });
  const delay = NETWORK_RETRY_MS[Math.min(r.attempt, NETWORK_RETRY_MS.length - 1)];
  r.timer = setTimeout(retryAfterNetworkError, delay);
  netRetrySub ??= addNetworkStateListener((net) => {
    if (net.isConnected !== false && netRetry?.timer) retryAfterNetworkError();
  });
}

function onPlaybackError(message: string, network = false, recreate = false) {
  // Auto-skip only while the user wants playback; a paused/stopped player just reports the error.
  const resume = wantPlay;
  clearWatchdog();
  // Android: the next `load()` rebuilds the window in the same player (the patched native side re-prepares it), so
  // the lock-screen session stays attached and keeps its next/previous buttons and seek bar. A new player is made
  // only when it fails again before playing, in case it is what is stuck. The web backend is always recreated.
  natBroken = recreate || Platform.OS === 'web' || errorsSincePlaying++ > 0;
  natReady = false;
  pendingSeekMs = null;
  if (network && resume) {
    waitForNetwork(message);
    return;
  }
  cancelNetworkRetry();
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
// The queue is stored as compact rows (queue-rows.ts) and saved debounced, only when it really changed. The
// index, modes and the current track are a tiny key written right away. At launch only that key is read, so the
// mini player has its song on the first frame; the queue itself is parsed after first paint (`restoreQueue`, from
// startCore) or, at the latest, on the first player call.

type PersistedQueue = { rows: QueueRow[]; original: number[] };
type LegacyQueue = { queue: AppTrack[]; original: number[] };
type PersistedState = { index: number; repeat: RepeatMode; shuffle: boolean; cur?: QueueRow };

/** The saved queue has been read into `entries`; until then nothing may write it (it would save an empty queue). */
let restored = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPendingSince = 0;
let lastQueueJson: string | null = null;

function persistState() {
  if (!restored) return;
  const { repeat, shuffle } = S();
  const cur = entries[index]?.track;
  kv.set(STATE_KEY, JSON.stringify({ index, repeat, shuffle, cur: cur ? toRow(cur) : undefined } satisfies PersistedState));
}

function scheduleQueuePersist() {
  if (!restored) return;
  const now = Date.now();
  if (persistTimer) {
    // Keep pushing the save back while edits keep coming, but not forever.
    if (now - persistPendingSince > QUEUE_SAVE_MAX_WAIT_MS) return;
    clearTimeout(persistTimer);
  } else {
    persistPendingSince = now;
  }
  persistTimer = setTimeout(flushQueuePersist, QUEUE_SAVE_DEBOUNCE_MS);
}

function flushQueuePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  persistQueueNow();
}

function persistQueueNow() {
  if (!restored) return;
  const pos = new Map(entries.map((e, i) => [e.uid, i]));
  const data: PersistedQueue = {
    rows: entries.map((e) => toRow(e.track)),
    original: original.map((e) => pos.get(e.uid) ?? -1).filter((i) => i >= 0),
  };
  const json = JSON.stringify(data);
  // Many publishes only change URIs (a download landed), which rows don't store.
  if (json === lastQueueJson) return;
  lastQueueJson = json;
  kv.set(QUEUE_KEY, json);
}

function savePosition() {
  kv.set(POSITION_KEY, Math.round(progressStore.getState().positionMs));
}

function readState(): Partial<PersistedState> {
  try {
    const raw = kv.getString(STATE_KEY);
    const st: unknown = raw ? JSON.parse(raw) : null;
    return st && typeof st === 'object' ? (st as Partial<PersistedState>) : {};
  } catch {
    return {};
  }
}

/** Modes and the current song only (see above). Restores everything now when the saved state predates `cur`. */
function restoreHead() {
  const st = readState();
  playerStore.setState({ repeat: st.repeat === 'all' || st.repeat === 'one' ? st.repeat : 'off', shuffle: !!st.shuffle });
  const cur = st.cur ? fromRow(st.cur) : null;
  if (!cur) return restoreQueue();
  const t = resolveTrack(cur);
  playerStore.setState({ queue: [t], index: 0, current: t });
  progressStore.setState({ positionMs: kv.getNumber(POSITION_KEY) ?? 0, durationMs: t.durationMs });
}

/** Reads the saved queue (once). Migrates the old full-JSON format. Safe to call any number of times. */
export function restoreQueue() {
  if (restored) return;
  restored = true;
  const st = readState();
  let migrated = false;
  try {
    let tracks: (AppTrack | null)[] = [];
    let order: unknown = [];
    const raw = kv.getString(QUEUE_KEY);
    if (raw) {
      lastQueueJson = raw;
      const q = JSON.parse(raw) as Partial<PersistedQueue>;
      tracks = Array.isArray(q.rows) ? q.rows.map((r) => fromRow(r)) : [];
      order = q.original;
    } else {
      const legacy = kv.getString(LEGACY_QUEUE_KEY);
      if (legacy) {
        migrated = true;
        const q = JSON.parse(legacy) as Partial<LegacyQueue>;
        tracks = Array.isArray(q.queue)
          ? q.queue.map((t) => (t && typeof t === 'object' && typeof t.key === 'string' ? fromStorable(t) : null))
          : [];
        order = q.original;
      }
    }
    // Saved positions → positions after dropping unreadable rows.
    const at: number[] = [];
    entries = [];
    for (const t of tracks) {
      at.push(t ? entries.length : -1);
      if (t) entries.push(toEntry(resolveTrack(t)));
    }
    const orig = Array.isArray(order) ? order.map((i) => (typeof i === 'number' ? (at[i] ?? -1) : -1)) : [];
    original =
      orig.length === entries.length && new Set(orig).size === entries.length && orig.every((i) => i >= 0)
        ? orig.map((i) => entries[i])
        : entries.slice();
    index = entries.length ? Math.min(Math.max(Number(st.index) || 0, 0), entries.length - 1) : -1;
    // The state key is written right away and the queue a little later; after a crash in between, find the song.
    const curKey = Array.isArray(st.cur) ? st.cur[0] : null;
    if (curKey && entries[index]?.track.key !== curKey) {
      const i = entries.findIndex((e) => e.track.key === curKey);
      if (i >= 0) index = i;
    }
  } catch (e) {
    console.warn('[player] could not restore queue', e);
    entries = [];
    original = [];
    index = -1;
  }
  const current = entries[index]?.track ?? null;
  const shownKey = S().current?.key;
  playerStore.setState({ queue: entries.map((e) => e.track), index, current });
  if (!st.cur || current?.key !== shownKey)
    progressStore.setState({ positionMs: current ? (kv.getNumber(POSITION_KEY) ?? 0) : 0, durationMs: current?.durationMs ?? 0 });
  if (migrated) {
    persistQueueNow();
    persistState();
    kv.remove(LEGACY_QUEUE_KEY);
  }
}

restoreHead();

AppState.addEventListener('change', (state) => {
  if (state === 'active' && windowDirty) syncWindow();
  if (state !== 'active') {
    savePosition();
    if (persistTimer) flushQueuePersist();
  }
});

/** Re-resolve URIs of queued tracks (server URL changed, download finished/removed). */
export function refreshQueueTracks() {
  restoreQueue();
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
  restoreQueue();
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
  restoreQueue();
  if (!entries.some((e) => fresh.has(e.track.key))) return;
  // In place: `original` holds the same Entry objects as `entries` (shuffle and playNext rely on that).
  for (const e of entries) {
    const t = fresh.get(e.track.key);
    if (t) e.track = resolveTrack(t);
  }
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
  started = false;
  activateLockScreen(entries[index].track);
  startNative();
  armWatchdog();
  playerStore.setState({ isPlaying: true, error: null });
}

function pause() {
  cancelNetworkRetry();
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
  // A lock-screen / media-key skip JS hasn't heard about yet must count, not be overwritten by this one.
  catchUpNative();
  const playing = isActive();
  const ni = nextIndex();
  if (ni === null) {
    // Next on the last song wraps to the first one and keeps playing (only a song ending on its own stops there).
    if (entries.length) {
      kv.set(POSITION_KEY, 0);
      load(0, playing);
    }
    return;
  }
  // After a JS skip whose event hasn't arrived yet, native is already on `advancingTo.ci`.
  const slot = advancingTo?.ci ?? natCur;
  if (nat && natReady && !natBroken && natUids[slot + 1] === entries[ni].uid && nat.trackCount === natUids.length) {
    // Already pre-buffered natively: let native advance; `onNativeIndex` finalizes state.
    index = ni;
    advancingTo = { ci: slot + 1, until: Date.now() + 2_000 };
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

/** Every entry point reads the saved queue first, in case it is called before startCore restored it. */
const restoring =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): R => {
    restoreQueue();
    return fn(...args);
  };

export const player = {
  playTracks: restoring(playTracks),
  togglePlay: restoring(() => (isActive() ? pause() : play())),
  play: restoring(play),
  pause: restoring(pause),
  next: restoring(next),
  previous: restoring(previous),
  seekTo: restoring(seekTo),
  playNext: restoring(playNext),
  addToQueue: restoring(addToQueue),
  removeFromQueue: restoring(removeFromQueue),
  moveInQueue: restoring(moveInQueue),
  jumpTo: restoring(jumpTo),
  setRepeat: restoring(setRepeat),
  cycleRepeat: restoring(cycleRepeat),
  toggleShuffle: restoring(toggleShuffle),
};
