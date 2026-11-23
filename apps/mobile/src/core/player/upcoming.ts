/**
 * What the queue shows as coming up, as queue indices in play order. Pure (unit-tested in test/upcoming.test.ts).
 *
 * `ahead` is everything after the current song. With repeat all, playback carries on from the top of the queue
 * after the last song (see `nextIndexIn`), so the songs before the current one come next too: `wrapped`. Showing
 * "Nothing up next" on the last song with repeat all on was wrong: Next plays the first song.
 */
export function upcoming(
  index: number,
  length: number,
  repeatAll: boolean,
  autoFrom = length,
): { ahead: number[]; wrapped: number[]; autoplay: number[] } {
  // Autoplay songs (`entries[autoFrom..]`, see autoplay.ts) come after everything the user chose.
  const end = Math.min(Math.max(autoFrom, index + 1), length);
  const ahead: number[] = [];
  for (let i = index + 1; i < end; i++) ahead.push(i);
  const autoplay: number[] = [];
  for (let i = end; i < length; i++) autoplay.push(i);
  const wrapped: number[] = [];
  if (repeatAll) for (let i = 0; i < Math.min(index, length); i++) wrapped.push(i);
  return { ahead, wrapped, autoplay };
}

/** The next `limit` songs in play order, wrapping with repeat all (the player's "Up next" card). */
export function nextUp(index: number, length: number, repeatAll: boolean, limit: number): number[] {
  const { ahead, wrapped, autoplay } = upcoming(index, length, repeatAll);
  return [...ahead, ...autoplay, ...wrapped].slice(0, limit);
}
