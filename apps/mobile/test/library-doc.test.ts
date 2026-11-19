import { describe, expect, test } from 'bun:test';

import { isDoc, mergeDocs, sameDoc, type LibraryDoc } from '../src/core/library-doc';

const pl = (updatedAt: number, tracks: string[] = []) => ({ name: 'P', createdAt: 1, updatedAt, cover: null, importId: null, tracks });
const doc = (d: Partial<LibraryDoc>): LibraryDoc => ({ v: 1, playlists: {}, likes: {}, ...d });

describe('mergeDocs', () => {
  test('no remote copy keeps the device as is', () => {
    const local = doc({ likes: { 'r:a': { at: 1, track: '{}' } } });
    expect(mergeDocs(local, null)).toBe(local);
  });

  test('newer side wins per playlist and per like; entries only one side has are kept', () => {
    const local = doc({
      playlists: { a: pl(5, ['x']), b: pl(1) },
      likes: { 'r:1': { at: 10, track: 'mine' }, 'r:2': { at: 1, track: 'old' } },
    });
    const remote = doc({
      playlists: { a: pl(3, ['y']), b: pl(2, ['z']), c: pl(1) },
      likes: { 'r:1': { at: 5, track: 'theirs' }, 'r:2': { deleted: true, at: 2 }, 'r:3': { at: 1, track: 'new' } },
    });
    const m = mergeDocs(local, remote);
    expect(m.playlists.a).toEqual(pl(5, ['x']));
    expect(m.playlists.b).toEqual(pl(2, ['z']));
    expect(m.playlists.c).toEqual(pl(1));
    expect(m.likes['r:1']).toEqual({ at: 10, track: 'mine' });
    expect(m.likes['r:2']).toEqual({ deleted: true, at: 2 }); // a newer unlike (tombstone) travels
    expect(m.likes['r:3']).toEqual({ at: 1, track: 'new' });
  });

  test('a tie keeps the device copy; a newer tombstone deletes a playlist', () => {
    const m = mergeDocs(doc({ playlists: { a: pl(4, ['mine']), d: pl(1) } }), doc({ playlists: { a: pl(4, ['theirs']), d: { deleted: true, updatedAt: 3 } } }));
    expect(m.playlists.a).toEqual(pl(4, ['mine']));
    expect(m.playlists.d).toEqual({ deleted: true, updatedAt: 3 });
  });

  test('sameDoc ignores key order', () => {
    const a = doc({ playlists: { a: pl(1), b: pl(2) } });
    const b = doc({ playlists: { b: pl(2), a: pl(1) } });
    expect(sameDoc(a, b)).toBe(true);
    expect(sameDoc(a, null)).toBe(false);
    expect(sameDoc(a, doc({ playlists: { a: pl(1) } }))).toBe(false);
  });
});

describe('isDoc', () => {
  test('accepts v1 with extra fields, rejects other versions and shapes', () => {
    expect(isDoc({ v: 1, playlists: {}, likes: {}, future: true })).toBe(true);
    for (const x of [null, 5, [], { v: 2, playlists: {}, likes: {} }, { v: 1, playlists: null, likes: {} }, { v: 1, playlists: {}, likes: [] }])
      expect({ x, ok: isDoc(x) }).toEqual({ x, ok: false });
  });
});
