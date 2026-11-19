// The native window planner (src/core/player/window.ts) against a fake native playlist that applies the edits.
import { describe, expect, test } from 'bun:test';

import { planTail, planWindow, prevIndexIn, resolveNativeMove, TRIM_BEHIND, WINDOW_AHEAD, WINDOW_MIN, type Slot, type WindowEdit } from '../src/core/player/window';

type Src = { uid: number; key: string };
const slot = (uid: number, key = `u${uid}`): Slot<Src> => ({ uid, src: { uid, key }, key });

/** Queue of uids 1..n; `keyOf` lets a test change a source (a download landing). */
function tail(queue: number[], index: number, repeatAll = false, playable: (uid: number) => boolean | 'skip' = () => true, keyOf = (u: number) => `u${u}`) {
  return planTail(queue.length, index, repeatAll, WINDOW_AHEAD, (i) => {
    const p = playable(queue[i]);
    if (p === 'skip') return 'skip';
    return p ? slot(queue[i], keyOf(queue[i])) : null;
  });
}

/** What native does with the edits, plus every intermediate track count (for the stale-event guarantee). */
function applyNative(native: Src[], edits: WindowEdit<Src>[]): { list: Src[]; counts: number[] } {
  const list = native.slice();
  const counts: number[] = [];
  for (const e of edits) {
    if (e.op === 'add') list.push(e.source);
    else if (e.op === 'insert') list.splice(e.index, 0, e.source);
    else list.splice(e.index, 1);
    counts.push(list.length);
  }
  return { list, counts };
}

/** Native window built like `load()`: [prev?, current, ...tail]. */
function loaded(queue: number[], index: number, repeatAll = false) {
  const uids = [...(index > 0 ? [queue[index - 1]] : []), queue[index], ...tail(queue, index, repeatAll).map((s) => s.uid)];
  return { uids, keys: uids.map((u) => `u${u}`), cur: index > 0 ? 1 : 0 };
}

/** Plans a sync for `queue`/`index` over native `uids`, applies it and checks mirror == native and the current slot. */
function sync(
  queue: number[],
  index: number,
  win: { uids: number[]; keys: string[]; cur: number },
  opts: { repeatAll?: boolean; advancing?: boolean; background?: boolean; keyOf?: (u: number) => string; playable?: (u: number) => boolean | 'skip' } = {},
) {
  const want = tail(queue, index, opts.repeatAll, opts.playable, opts.keyOf);
  const pi = prevIndexIn(index, queue.length, !!opts.repeatAll);
  const plan = planWindow({
    uids: win.uids,
    keys: win.keys,
    curSlot: win.cur,
    want,
    prev: pi === null ? null : slot(queue[pi], opts.keyOf?.(queue[pi])),
    advancing: !!opts.advancing,
    background: !!opts.background,
  });
  if (plan.kind !== 'edit') return { plan, win };
  const native = win.uids.map((u, i) => ({ uid: u, key: win.keys[i] }));
  const { list, counts } = applyNative(native, plan.edits);
  expect(list.map((s) => s.uid)).toEqual(plan.uids);
  expect(list.map((s) => s.key)).toEqual(plan.keys);
  const cur = win.cur - plan.trimmed;
  // The current song never moves or changes under the player.
  expect(plan.uids[cur]).toBe(win.uids[win.cur]);
  if (plan.trimmed > 0) {
    // Index-shifting edits: no event from before or during the edit may carry the final track count.
    expect([win.uids.length, ...counts.slice(0, -1)]).not.toContain(plan.uids.length);
  } else {
    // Without a trim, nothing before the current slot shifts at any point.
    let at = win.cur;
    for (const e of plan.edits) {
      if (e.op === 'insert' && e.index <= at) at++;
      if (e.op === 'remove' && e.index < at) at--;
      if (e.op === 'insert' || e.op === 'remove') expect(e.index).toBeGreaterThanOrEqual(win.cur - 1);
    }
    expect(at).toBe(win.cur);
  }
  return { plan, win: { uids: plan.uids, keys: plan.keys, cur } };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('planTail', () => {
  test('stops at the end of the queue without repeat-all', () => {
    expect(tail(range(4), 1).map((s) => s.uid)).toEqual([3, 4]);
    expect(tail(range(20), 0).map((s) => s.uid)).toEqual([2, 3, 4, 5, 6]);
  });

  test('repeat-all wraps once around the queue', () => {
    expect(tail(range(1), 0, true)).toEqual([]);
    expect(tail(range(2), 1, true).map((s) => s.uid)).toEqual([1]);
    expect(tail(range(3), 2, true).map((s) => s.uid)).toEqual([1, 2]);
    expect(tail(range(8), 6, true).map((s) => s.uid)).toEqual([8, 1, 2, 3, 4]);
  });

  test('an unplayable entry ends the window; offline skips streamed ones', () => {
    expect(tail(range(6), 0, false, (u) => u !== 3).map((s) => s.uid)).toEqual([2]);
    expect(tail(range(9), 0, false, (u) => (u % 3 === 0 ? true : 'skip')).map((s) => s.uid)).toEqual([3, 6, 9]);
  });
});

describe('prevIndexIn', () => {
  test('wraps only with repeat-all and more than one song', () => {
    expect(prevIndexIn(2, 4, false)).toBe(1);
    expect(prevIndexIn(0, 4, false)).toBeNull();
    expect(prevIndexIn(0, 4, true)).toBe(3);
    expect(prevIndexIn(0, 1, true)).toBeNull();
  });

  test('offline it steps back over streamed songs instead of bouncing into one', () => {
    const downloaded = new Set([0, 3]);
    const playable = (i: number) => downloaded.has(i);
    expect(prevIndexIn(5, 6, false, playable)).toBe(3);
    expect(prevIndexIn(3, 6, false, playable)).toBe(0);
    // Nothing downloaded before the first one: restart the song (null), wrap only with repeat-all.
    expect(prevIndexIn(0, 6, false, playable)).toBeNull();
    expect(prevIndexIn(0, 6, true, playable)).toBe(3);
    expect(prevIndexIn(3, 6, false, () => false)).toBeNull();
    expect(prevIndexIn(3, 6, true, () => false)).toBeNull();
  });
});

describe('resolveNativeMove', () => {
  const base = { forward: false, oneBack: false, idx: 0, index: 5, prevIdx: 4, nextIdx: 6, repeatAll: false };

  test('a native move that follows the queue is accepted', () => {
    expect(resolveNativeMove({ ...base, forward: true, idx: 6 })).toEqual({ kind: 'accept' });
    expect(resolveNativeMove({ ...base, oneBack: true, idx: 4 })).toEqual({ kind: 'accept' });
    // Repeat-all: advancing into the queue's start is the wrap itself.
    expect(resolveNativeMove({ ...base, forward: true, idx: 0, index: 9, nextIdx: 0, repeatAll: true })).toEqual({ kind: 'accept' });
  });

  test('lock-screen previous onto a stale slot (a song dragged above the current one) plays the in-app previous', () => {
    // The slot behind still holds entry 7 (it was dragged below), while the in-app previous is 4.
    expect(resolveNativeMove({ ...base, oneBack: true, idx: 7 })).toEqual({ kind: 'load', index: 4 });
    // On the first song (no previous): restart it.
    expect(resolveNativeMove({ ...base, oneBack: true, idx: 3, index: 0, prevIdx: null })).toEqual({ kind: 'load', index: 0 });
  });

  test('a burst of previous presses is kept when it went back in the queue', () => {
    expect(resolveNativeMove({ ...base, idx: 2 })).toEqual({ kind: 'accept' });
    // ...but not when the slots it landed on are now after the current song.
    expect(resolveNativeMove({ ...base, idx: 8 })).toEqual({ kind: 'load', index: 4 });
  });

  test('a wrap left in the window after repeat-all was turned off goes where the queue goes, or stops', () => {
    expect(resolveNativeMove({ ...base, forward: true, idx: 0, index: 9, nextIdx: null })).toEqual({ kind: 'stop' });
    expect(resolveNativeMove({ ...base, forward: true, idx: 1, index: 5, nextIdx: 6 })).toEqual({ kind: 'load', index: 6 });
  });

  test('nothing is redirected before a song is current', () => {
    expect(resolveNativeMove({ ...base, oneBack: true, idx: 3, index: -1 })).toEqual({ kind: 'accept' });
  });
});

describe('planWindow', () => {
  test('a freshly loaded window needs nothing', () => {
    const q = range(10);
    expect(sync(q, 3, loaded(q, 3)).plan.kind).toBe('none');
    expect(sync(q, 0, loaded(q, 0)).plan.kind).toBe('none');
  });

  test('advancing tops up only once the window runs low', () => {
    const q = range(20);
    let win = loaded(q, 0);
    for (let i = 1; i < 15; i++) {
      win = { ...win, cur: win.cur + 1 }; // native auto-advance
      const r = sync(q, i, win);
      const ahead = win.uids.length - 1 - win.cur;
      if (r.plan.kind === 'none') expect(ahead).toBeGreaterThanOrEqual(WINDOW_MIN);
      win = r.win;
      expect(win.uids.slice(win.cur + 1)).toEqual(tail(q, i).slice(0, win.uids.length - 1 - win.cur).map((s) => s.uid));
      // Played slots never pile up past TRIM_BEHIND.
      expect(win.cur).toBeLessThanOrEqual(TRIM_BEHIND);
    }
  });

  test('shuffle: everything after the current song and the slot behind follow the new order', () => {
    const before = range(10);
    const win = loaded(before, 4);
    const after = [5, 9, 2, 7, 1, 10, 3, 8, 4, 6]; // current (5) moved to the front, as toggleShuffle does
    const r = sync(after, 0, win);
    expect(r.win.uids.slice(r.win.cur + 1)).toEqual([9, 2, 7, 1, 10]);
    // No previous song at the start of the queue. Removing the stale slot behind would shift the current index
    // without the trim guarantee (one slot removed, five added), so it stays; onNativeIndex redirects a native
    // previous onto it (restart the song).
    expect(r.win.uids[r.win.cur - 1]).toBe(4);
  });

  test('reorder: a song dragged before the current one fixes the slot behind in place', () => {
    const q = [1, 2, 3, 4, 5, 6];
    const win = loaded(q, 2); // [2, 3, 4, 5, 6], on 3
    const moved = [2, 1, 3, 4, 5, 6]; // 2 dragged to the top: previous is now 1
    const r = sync(moved, 2, win);
    expect(r.win.uids).toEqual([1, 3, 4, 5, 6]);
    expect(r.win.cur).toBe(1);
  });

  test('removing upcoming songs and songs before the current one', () => {
    const q = range(10);
    const win = loaded(q, 3); // [3, 4, 5..9]
    const r1 = sync([1, 2, 3, 4, 6, 8, 9, 10], 3, win); // 5 and 7 removed
    expect(r1.win.uids.slice(r1.win.cur + 1)).toEqual([6, 8, 9, 10]);
    const r2 = sync([1, 4, 6, 8, 9, 10], 1, r1.win); // 2 and 3 removed: previous is 1 now
    expect(r2.win.uids[r2.win.cur - 1]).toBe(1);
  });

  test('a download landing replaces just that slot', () => {
    const q = range(8);
    const win = loaded(q, 2);
    const r = sync(q, 2, win, { keyOf: (u) => (u === 5 ? 'file5' : `u${u}`) });
    expect(r.plan.kind).toBe('edit');
    expect(r.win.uids).toEqual(win.uids);
    expect(r.win.keys[r.win.uids.indexOf(5)]).toBe('file5');
  });

  test('repeat-all wrap for 1, 2 and 3 songs, and turning it off drops the wrapped slots', () => {
    expect(loaded([1], 0, true).uids).toEqual([1]);
    expect(sync([1], 0, loaded([1], 0, true), { repeatAll: true }).plan.kind).toBe('none');

    const two = [1, 2];
    const w2 = loaded(two, 1, true); // [1, 2, 1]
    expect(w2.uids).toEqual([1, 2, 1]);
    expect(sync(two, 1, w2, { repeatAll: true }).plan.kind).toBe('none');
    // Native wraps to the first song (slot 2); the slot behind (2) is its previous with repeat-all.
    const wrapped = sync(two, 0, { ...w2, cur: 2 }, { repeatAll: true });
    expect(wrapped.win.uids[wrapped.win.cur - 1]).toBe(2);
    expect(wrapped.win.uids[wrapped.win.cur + 1]).toBe(2);

    const three = [1, 2, 3];
    const w3 = loaded(three, 2, true); // [2, 3, 1, 2]
    expect(w3.uids).toEqual([2, 3, 1, 2]);
    const off = sync(three, 2, w3);
    expect(off.win.uids).toEqual([2, 3]);
  });

  test('in the background only a window running low is edited', () => {
    const q = range(10);
    const win = loaded(q, 3);
    // A reorder far ahead with plenty left: deferred.
    expect(sync([1, 2, 3, 4, 5, 6, 7, 9, 8, 10], 3, win, { background: true }).plan.kind).toBe('defer');
    // Down to one upcoming song: topped up even in the background.
    const low = { ...win, cur: win.uids.length - 2 };
    expect(sync(q, 8, low, { background: true }).plan.kind).toBe('edit');
  });

  test('mid-skip the slot behind is left alone (native may still be on it)', () => {
    const q = [1, 2, 3, 4, 5];
    const win = loaded(q, 2);
    const r = sync([2, 1, 3, 4, 5], 2, win, { advancing: true });
    expect(r.plan.kind).toBe('none');
  });
});
