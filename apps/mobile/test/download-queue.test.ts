import { expect, test } from 'bun:test';

import { renameInQueue, type QueuedItem } from '../src/core/download-queue';

type T = { key: string; id: string; title: string };
type I = QueuedItem<T> & { error?: string };
const item = (id: string, status: I['status'] = 'queued', error?: string): I => ({ track: { key: `r:${id}`, id, title: id }, status, error });
const fresh = (track: T): I => ({ track, status: 'queued' });

function queue(...its: I[]) {
  return { items: Object.fromEntries(its.map((i) => [i.track.key, i])), order: its.map((i) => i.track.key) };
}

test('moved waiting and failed items take the new id in place and start over', () => {
  const q = queue(item('a'), item('b', 'error', 'No longer on the server'), item('c'));
  const r = renameInQueue(q.items, q.order, new Map([['r:b', 'r:B']]), () => false, fresh)!;
  expect(r.order).toEqual(['r:a', 'r:B', 'r:c']);
  expect(r.items['r:B']).toEqual({ track: { key: 'r:B', id: 'B', title: 'b' }, status: 'queued' });
  expect(r.items['r:b']).toBeUndefined();
  expect(r.dropped).toEqual(['r:b']);
});

test('a running transfer keeps its old key', () => {
  const q = queue(item('a', 'downloading'));
  expect(renameInQueue(q.items, q.order, new Map([['r:a', 'r:A']]), () => false, fresh)).toBeNull();
});

test('a move onto a song already queued or downloaded is not queued twice', () => {
  const q = queue(item('a'), item('B'), item('c'));
  const r = renameInQueue(q.items, q.order, new Map([['r:a', 'r:B'], ['r:c', 'r:C']]), (k) => k === 'r:C', fresh)!;
  expect(r.order).toEqual(['r:B']);
  expect(Object.keys(r.items)).toEqual(['r:B']);
  expect(r.dropped).toEqual(['r:a', 'r:c']);
});

test('nothing moved: null', () => {
  const q = queue(item('a'));
  expect(renameInQueue(q.items, q.order, new Map([['r:x', 'r:y']]), () => false, fresh)).toBeNull();
});
