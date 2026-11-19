/**
 * Pure transforms of the download queue (items by key + order), so their edge cases are unit-tested
 * (test/download-queue.test.ts). No native or React imports.
 */

/** The part of a queued download these transforms read and write. */
export type QueuedItem<T extends { key: string; id: string }> = { track: T; status: 'queued' | 'downloading' | 'error' };

/**
 * Follows songs the server moved (old key -> new key): waiting and failed items switch to the new id and start over
 * as queued, keeping their place. A running transfer keeps its old key (it finishes or fails under it; the next
 * prune moves it). A move onto a song already queued or downloaded drops the old item instead of queueing it twice.
 * `dropped`: old keys that left the queue (their retry timers are cleared). Null when nothing moved.
 */
export function renameInQueue<T extends { key: string; id: string }, I extends QueuedItem<T>>(
  items: Readonly<Record<string, I>>,
  order: readonly string[],
  moves: ReadonlyMap<string, string>,
  isDownloaded: (key: string) => boolean,
  fresh: (track: T) => I,
): { items: Record<string, I>; order: string[]; dropped: string[] } | null {
  const nextItems = { ...items };
  const nextOrder: string[] = [];
  const dropped: string[] = [];
  for (const k of order) {
    const to = moves.get(k);
    const it = items[k];
    if (!to || it.status === 'downloading') {
      nextOrder.push(k);
      continue;
    }
    dropped.push(k);
    delete nextItems[k];
    if (nextItems[to] || isDownloaded(to)) continue;
    nextItems[to] = fresh({ ...it.track, key: to, id: to.slice(2) });
    nextOrder.push(to);
  }
  return dropped.length ? { items: nextItems, order: nextOrder, dropped } : null;
}
