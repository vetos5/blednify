/**
 * What the queue shows as coming up, as queue indices in play order. Pure (unit-tested in test/upcoming.test.ts).
 *
 * `ahead` is everything after the current song. With repeat all, playback carries on from the top of the queue
 * after the last song (see `nextIndexIn`), so the songs before the current one come next too: `wrapped`. Showing
 * "Nothing up next" on the last song with repeat all on was wrong: Next plays the first song.
 */
export function upcoming(index: number, length: number, repeatAll: boolean): { ahead: number[]; wrapped: number[] } {
  const ahead: number[] = [];
  for (let i = index + 1; i < length; i++) ahead.push(i);
  const wrapped: number[] = [];
  if (repeatAll) for (let i = 0; i < Math.min(index, length); i++) wrapped.push(i);
  return { ahead, wrapped };
}

/** The next `limit` songs in play order, wrapping with repeat all (the player's "Up next" card). */
export function nextUp(index: number, length: number, repeatAll: boolean, limit: number): number[] {
  const { ahead, wrapped } = upcoming(index, length, repeatAll);
  return [...ahead, ...wrapped].slice(0, limit);
}
