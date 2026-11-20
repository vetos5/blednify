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
