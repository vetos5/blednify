/** The parts of the player state the after-error prune looks at. */
export type PruneGateState = {
  errorId: number;
  isPlaying: boolean;
  isBuffering: boolean;
  retrying: boolean;
  current: { origin: string; localUri?: string | null } | null;
};

/** A song that has to come from the server right now (not a download, not a device file). */
function streamed(s: PruneGateState): boolean {
  return s.current?.origin === 'remote' && !s.current.localUri;
}

/**
 * When to check for songs the server deleted after a streamed song fails to play.
 *
 * A failure only arms the check; it runs once a streamed song is actually playing, which proves the server answers.
 * "Playing" means playing and not buffering: the engine publishes isPlaying (and isBuffering) as soon as a song starts
 * loading, before a byte has arrived, so isPlaying alone is only the intent to play.
 * Pruning straight away sent /api/tracks/lookup and /api/tracks/gone into a dead server on every song change while
 * offline (2 failed requests each). A network failure (the engine is retrying) never arms it: "the song was deleted"
 * is only plausible when the server answered and still couldn't play it.
 */
export function pruneGate(armed: boolean, s: PruneGateState, prev: PruneGateState): { armed: boolean; runNow: boolean } {
  let next = armed;
  if (s.errorId !== prev.errorId && streamed(s) && !s.retrying) next = true;
  if (next && s.isPlaying && !s.isBuffering && !s.retrying && streamed(s)) return { armed: false, runNow: true };
  return { armed: next, runNow: false };
}
