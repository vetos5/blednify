/**
 * What the load/play watchdog does when a song hasn't started in time (see `armWatchdog` in engine.ts), and how a
 * playback error is taken. Pure, so the decisions are unit-tested (test/stall.test.ts); the engine does the I/O.
 *
 * Two kinds of "nothing happens" look the same from JS:
 * - a wedged player (after a Bluetooth headset vanished mid-song every load in that player hung): a new player
 *   fixes it, and the server answers a health check;
 * - a connection that hangs instead of failing (Wi-Fi without internet, a dead zone): the server doesn't answer.
 *   Recreating the player then fixes nothing and resets the lock-screen session on every attempt, so it is taken
 *   as one more network failure and retried in place, like a refused connection.
 * A song that plays without the network (downloaded, on the phone) can only be a wedged player.
 */

export type StallInput = {
  /** Still wanted, not started, and still on the song the watchdog was armed for. */
  current: boolean;
  /** Native says it is playing (JS was throttled and missed the event). */
  nativePlaying: boolean;
  /** This song needs the network. */
  streams: boolean;
  /** First stall on this song: retried quietly. */
  quiet: boolean;
  /** Result of the server health probe, once asked; undefined before. */
  serverAnswers?: boolean;
};

export type StallAction =
  | 'none'
  /** It is playing: mark started. */
  | 'started'
  /** Ask the server (GET /api/health) and decide again with `serverAnswers`. */
  | 'probe'
  /** The server can't be reached: a network failure, retried in the same player. */
  | 'network-error'
  /** First stall: reload in a new player at the same position, without telling the user. */
  | 'reload-new-player'
  /** Again: report it and handle it like a dropped connection, in a new player. */
  | 'report-recreate';

export function stallAction({ current, nativePlaying, streams, quiet, serverAnswers }: StallInput): StallAction {
  if (!current) return 'none';
  if (nativePlaying) return 'started';
  if (streams && serverAnswers === undefined) return 'probe';
  if (streams && !serverAnswers) return 'network-error';
  return quiet ? 'reload-new-player' : 'report-recreate';
}

/**
 * How a playback error is taken. `retrying`: the user wants playback and it is the network, so the song is retried
 * where it stopped. `natBroken`: the next load makes a new player. A dropped connection never counts towards that
 * (its retries re-prepare the same player, keeping the lock-screen session); the web backend is always recreated;
 * otherwise a second error before anything played does it.
 */
export function errorPlan({
  network,
  wantPlay,
  recreate,
  web,
  errorsSincePlaying,
}: {
  network: boolean;
  wantPlay: boolean;
  recreate: boolean;
  web: boolean;
  errorsSincePlaying: number;
}): { retrying: boolean; natBroken: boolean } {
  const retrying = network && wantPlay;
  return { retrying, natBroken: recreate || web || (!retrying && errorsSincePlaying > 0) };
}

/**
 * What the player store says about playing and buffering, from a native status. While a dropped connection is being
 * retried (`retrying`, from the first failure until the song plays, the user pauses, or the retry gives up) native
 * alternates between "buffering, about to play" and "idle after an error" on every attempt; reading those straight
 * through made the play button jump between its plain Pause and the busy ring (and its spoken label with it). The
 * engine owns that state instead: busy, not playing, for the whole backoff.
 */
export function publishedPlayState({
  nativePlaying,
  nativeBuffering,
  isLoaded,
  wantPlay,
  retrying,
}: {
  nativePlaying: boolean;
  nativeBuffering: boolean;
  isLoaded: boolean;
  wantPlay: boolean;
  retrying: boolean;
}): { isPlaying: boolean; isBuffering: boolean } {
  if (retrying && wantPlay) return { isPlaying: false, isBuffering: true };
  return { isPlaying: nativePlaying, isBuffering: wantPlay && (nativeBuffering || !isLoaded) };
}

export type PlayButtonMode = 'play' | 'pause' | 'busy';

/** The play button: Play, Pause, or the busy ring around a Pause (a tap cancels the load or the retry). */
export function playButtonMode({
  isPlaying,
  isBuffering,
  retrying,
}: {
  isPlaying: boolean;
  isBuffering: boolean;
  retrying: boolean;
}): PlayButtonMode {
  if (retrying || (isBuffering && !isPlaying)) return 'busy';
  return isPlaying ? 'pause' : 'play';
}

/** Spoken label of the play button: the busy one says what a tap does (it stops the load or the retry). */
export function playButtonLabel(mode: PlayButtonMode, retrying: boolean): string {
  if (mode === 'busy') return retrying ? 'Reconnecting, pause' : 'Loading, pause';
  return mode === 'pause' ? 'Pause' : 'Play';
}

/**
 * Whether a native status may set the published position (and, through it, the saved one). Only a loaded player knows
 * where the song is: one being re-prepared after an error, or a window rebuilt at a position that hasn't loaded yet,
 * reports 0. Publishing that once lost the place in a song: Pause and Play during an outage reloaded it from the 0,
 * and the song restarted from the top when the server came back. A seek still settling holds the position too.
 */
export function statusSetsPosition({ isLoaded, seekGuarded }: { isLoaded: boolean; seekGuarded: boolean }): boolean {
  return isLoaded && !seekGuarded;
}

/**
 * Where a retry in the same player (`retryInPlace`) must put the song, or null to leave it. A player that had loaded
 * the song keeps its own position through an error (ExoPlayer re-prepares where it stopped). A window rebuilt for the
 * song that failed before loading (Play after a pause during an outage, Play on a restored session while the server is
 * down) sits at 0: the place is the seek still pending, or else the published position.
 */
export function retrySeekMs({
  curLoaded,
  pendingSeekMs,
  publishedMs,
}: {
  curLoaded: boolean;
  pendingSeekMs: number | null;
  publishedMs: number;
}): number | null {
  if (pendingSeekMs !== null) return pendingSeekMs;
  if (curLoaded) return null;
  return publishedMs > 0 ? publishedMs : null;
}
