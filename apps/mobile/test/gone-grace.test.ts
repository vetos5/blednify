import { expect, test } from 'bun:test';

import { GONE_GRACE_MS, ripenGone } from '../src/core/gone-grace';

const none = () => false;

test('a deleted song is dropped only after it stayed deleted for the grace period', () => {
  const t0 = 1_000_000;
  const first = ripenGone({}, ['r:a'], none, t0, true);
  expect(first).toEqual({ next: { 'r:a': t0 }, ripe: [] });
  const later = ripenGone(first.next, ['r:a'], none, t0 + GONE_GRACE_MS - 1, true);
  expect(later.ripe).toEqual([]);
  const ripe = ripenGone(later.next, ['r:a'], none, t0 + GONE_GRACE_MS, true);
  expect(ripe).toEqual({ next: {}, ripe: ['r:a'] });
});

test('a song that came back (drive mounted again) starts over', () => {
  const t0 = 5_000;
  const seen = ripenGone({}, ['r:a', 'r:b'], none, t0, true).next;
  // Complete check: r:a is no longer gone, so its date is forgotten.
  const back = ripenGone(seen, ['r:b'], none, t0 + 1000, true);
  expect(back.next).toEqual({ 'r:b': t0 });
  const gone = ripenGone(back.next, ['r:a', 'r:b'], none, t0 + GONE_GRACE_MS, true);
  expect(gone.ripe).toEqual(['r:b']);
  expect(gone.next).toEqual({ 'r:a': t0 + GONE_GRACE_MS });
});

test('an incomplete check keeps dates of keys it did not get to', () => {
  const seen = { 'r:a': 1, 'r:b': 2 };
  expect(ripenGone(seen, [], none, 10, false).next).toEqual(seen);
});

test('downloaded songs are never dropped', () => {
  const r = ripenGone({ 'r:a': 0 }, ['r:a'], (k) => k === 'r:a', GONE_GRACE_MS * 2, true);
  expect(r).toEqual({ next: {}, ripe: [] });
});
