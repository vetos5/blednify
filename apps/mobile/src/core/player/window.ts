/**
 * Pure planning of the native window (see the header of engine.ts): which queue entries follow the current one
 * natively, and the playlist edits that bring the native slots in line with the queue. No native or React imports,
 * so the index arithmetic is unit-tested (test/window.test.ts) against a fake native playlist.
 */

/** Upcoming tracks the native playlist is filled up to after the current one. */
export const WINDOW_AHEAD = 5;
/**
 * Top up once fewer than this many upcoming tracks are left natively. With 5/3 the playlist is edited once every
 * three songs, and native still has two songs queued when it advances before JS has had a chance to run.
 */
export const WINDOW_MIN = 3;
/** Played slots kept before the current one (native "previous"); more than TRIM_BEHIND are trimmed. */
export const KEEP_BEHIND = 1;
/** Must stay above WINDOW_AHEAD (see `planWindow`, stale status events). */
export const TRIM_BEHIND = 8;

/** A queue entry as loaded in a native slot: its uid, source and the source's identity (URI + credential). */
export type Slot<S> = { uid: number; src: S; key: string };

/** The subset of the native `PlaylistEdit` ops a window sync uses. */
export type WindowEdit<S> = { op: 'insert'; index: number; source: S } | { op: 'remove'; index: number } | { op: 'add'; source: S };

/**
 * Index the in-app Previous goes to from `i` (when not restarting the song); repeat-all wraps. With `playable`
 * (offline: only downloaded songs) entries it rejects are stepped over, like `planTail` leaves them out ahead.
 */
export function prevIndexIn(i: number, n: number, repeatAll: boolean, playable?: (i: number) => boolean): number | null {
  const back = repeatAll ? n - 1 : i;
  for (let k = 1; k <= back; k++) {
    const j = (i - k + n) % n;
    if (!playable || playable(j)) return j;
  }
  return null;
}

/** What to do when native reports it moved to the slot of queue entry `idx` (see `onNativeIndex` in engine.ts). */
export type NativeMove = { kind: 'accept' } | { kind: 'load'; index: number } | { kind: 'stop' };

/**
 * Redirects a native move that doesn't follow the queue. `forward`: native moved to a later slot; `oneBack`: exactly
 * one slot back. `index`: the JS current entry; `prevIdx`/`nextIdx`: where the in-app Previous/Next would go.
 * - One step back must land on the in-app previous song (the slot behind can be stale after a shuffle or reorder the
 *   background deferred). A burst of presses (several slots at once) is only redirected when it didn't go back in
 *   the queue at all.
 * - A forward move into an entry before the current one without repeat-all (a wrap left from when repeat-all was on,
 *   or an unsynced reorder) goes where the queue goes instead, or stops at the end.
 */
export function resolveNativeMove(m: {
  forward: boolean;
  oneBack: boolean;
  idx: number;
  index: number;
  prevIdx: number | null;
  nextIdx: number | null;
  repeatAll: boolean;
}): NativeMove {
  const { forward, oneBack, idx, index, prevIdx, nextIdx, repeatAll } = m;
  if (index < 0) return { kind: 'accept' };
  if (!forward && idx !== prevIdx && (oneBack || idx >= index)) return { kind: 'load', index: prevIdx ?? index };
  if (forward && idx < index && !repeatAll) return nextIdx === null ? { kind: 'stop' } : { kind: 'load', index: nextIdx };
  return { kind: 'accept' };
}

/**
 * Upcoming entries that may follow entry `index` natively, up to `max`. With repeat-all the window wraps to the
 * start of the queue (each entry once). `slotAt` returns the entry's slot, `'skip'` to leave it out (offline:
 * streamed songs), or null when it can't play, which ends the window there.
 */
export function planTail<S>(
  n: number,
  index: number,
  repeatAll: boolean,
  max: number,
  slotAt: (i: number) => Slot<S> | 'skip' | null,
): Slot<S>[] {
  const out: Slot<S>[] = [];
  const upcoming = repeatAll ? n - 1 : n - 1 - index;
  for (let k = 1; k <= upcoming && out.length < max; k++) {
    const s = slotAt((index + k) % n);
    if (s === 'skip') continue;
    if (!s) break;
    out.push(s);
  }
  return out;
}

export type WindowInput<S> = {
  /** Entry uid and source key per native slot (the JS mirror). */
  uids: readonly number[];
  keys: readonly string[];
  /** Slot native is on (or is moving to, after a JS skip). */
  curSlot: number;
  /** `planTail` for the current entry. */
  want: readonly Slot<S>[];
  /** What the in-app Previous plays, when it has a source. */
  prev: Slot<S> | null;
  /** A JS skip is waiting for native to report it: native may still be on the slot behind. */
  advancing: boolean;
  /** Backgrounded with the lock screen active: only edits that keep playback going are made. */
  background: boolean;
};

export type WindowPlan<S> =
  | { kind: 'none' }
  | { kind: 'defer' }
  /** Apply `edits` in one native call; the mirror becomes `uids`/`keys`; the current slot moves back by `trimmed`. */
  | { kind: 'edit'; edits: WindowEdit<S>[]; uids: number[]; keys: string[]; trimmed: number };

/**
 * The edits that bring the native slots after the current one in line with the queue, with as few native calls as
 * possible: a slot whose source changed (download landed, new server URL or token) is replaced in place, slots
 * after the first entry that differs are removed and re-added, and the window is topped up to WINDOW_AHEAD once
 * fewer than WINDOW_MIN upcoming tracks are left. `none` when native already matches, the usual case after an
 * advance. The slot behind the current one (native "previous") is kept equal to `prev`.
 */
export function planWindow<S>({ uids, keys, curSlot, want, prev, advancing, background }: WindowInput<S>): WindowPlan<S> {
  const haveUids = uids.slice(curSlot + 1);
  const haveKeys = keys.slice(curSlot + 1);
  let same = 0;
  while (same < want.length && same < haveUids.length && want[same].uid === haveUids[same]) same++;
  const replace: number[] = [];
  for (let k = 0; k < same; k++) if (want[k].key !== haveKeys[k]) replace.push(k);
  const drop = haveUids.length - same;
  const low = same < Math.min(want.length, WINDOW_MIN);
  // The slot behind the current one is what native "previous" (lock screen, headset, car) plays. After a shuffle,
  // reorder or removal it can hold a song that no longer comes before this one; fix it so native previous lands
  // where the in-app button would. Not mid-skip (native may still be on that slot).
  const behindStale = !advancing && curSlot > 0 && uids[curSlot - 1] !== prev?.uid;
  // Replaced in place (count unchanged) when there is a previous song; else every slot behind is removed (then
  // native previous falls through to `remoteSkip`), which shifts indices like `trim` below and so needs the same
  // guarantee: more slots trimmed than added. When that doesn't hold yet, `onNativeIndex` catches a native
  // previous that lands on a stale slot.
  const replaceBehind = behindStale && !!prev;
  // Fill up whenever the playlist is edited anyway, so edits stay rare.
  const add = low || drop > 0 || replace.length > 0 || behindStale ? want.slice(same) : [];
  const clearBehind = behindStale && !prev && curSlot > add.length;
  if (!replace.length && !drop && !add.length && !replaceBehind && !clearBehind) return { kind: 'none' };
  // In the background, edit only when native is about to run out of the right songs (see engine.ts header).
  if (!low && background) return { kind: 'defer' };
  // Trimming shifts native indices. It is only done when it removes more slots than are added (TRIM_BEHIND >
  // WINDOW_AHEAD), so no status event from before or during this edit has the final track count, and the
  // `trackCount` check in `onStatus` drops all of them.
  const trim = clearBehind ? curSlot : !advancing && curSlot > TRIM_BEHIND ? curSlot - KEEP_BEHIND : 0;
  const nextUids = uids.slice();
  const nextKeys = keys.slice();
  const edits: WindowEdit<S>[] = [];
  if (replaceBehind && prev) {
    // Insert before the stale slot, then remove it: the current slot's index is the same before and after.
    const slot = curSlot - 1;
    edits.push({ op: 'insert', index: slot, source: prev.src }, { op: 'remove', index: slot + 1 });
    nextUids[slot] = prev.uid;
    nextKeys[slot] = prev.key;
  }
  for (const k of replace) {
    const slot = curSlot + 1 + k;
    edits.push({ op: 'insert', index: slot, source: want[k].src }, { op: 'remove', index: slot + 1 });
    nextKeys[slot] = want[k].key;
  }
  for (let i = nextUids.length - 1; i > curSlot + same; i--) {
    edits.push({ op: 'remove', index: i });
    nextUids.pop();
    nextKeys.pop();
  }
  for (const w of add) {
    edits.push({ op: 'add', source: w.src });
    nextUids.push(w.uid);
    nextKeys.push(w.key);
  }
  for (let k = 0; k < trim; k++) {
    edits.push({ op: 'remove', index: 0 });
    nextUids.shift();
    nextKeys.shift();
  }
  return { kind: 'edit', edits, uids: nextUids, keys: nextKeys, trimmed: trim };
}
