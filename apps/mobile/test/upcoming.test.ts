import { describe, expect, test } from 'bun:test';

import { nextUp, upcoming } from '../src/core/player/upcoming';
import { nextIndexIn } from '../src/core/player/window';

describe('upcoming', () => {
  test('without repeat only songs after the current one come up', () => {
    expect(upcoming(1, 4, false)).toEqual({ ahead: [2, 3], wrapped: [], autoplay: [] });
    expect(upcoming(3, 4, false)).toEqual({ ahead: [], wrapped: [], autoplay: [] });
  });
  test('repeat all: the head of the queue follows, so the last song is not "nothing up next"', () => {
    expect(upcoming(3, 4, true)).toEqual({ ahead: [], wrapped: [0, 1, 2], autoplay: [] });
    expect(upcoming(1, 4, true)).toEqual({ ahead: [2, 3], wrapped: [0], autoplay: [] });
    expect(upcoming(0, 4, true)).toEqual({ ahead: [1, 2, 3], wrapped: [], autoplay: [] });
  });
  test('a single song with repeat all has nothing else to show', () => {
    expect(upcoming(0, 1, true)).toEqual({ ahead: [], wrapped: [], autoplay: [] });
  });
  test('play order matches what Next does', () => {
    for (const [i, n] of [[0, 5], [2, 5], [4, 5]]) {
      const order = nextUp(i, n, true, n);
      let at = i;
      for (const want of order) {
        at = nextIndexIn(at, n, true)!;
        expect(at).toBe(want);
      }
    }
  });
});

describe('nextUp', () => {
  test('caps at the limit and wraps with repeat all', () => {
    expect(nextUp(8, 10, true, 4)).toEqual([9, 0, 1, 2]);
    expect(nextUp(8, 10, false, 4)).toEqual([9]);
  });
});
