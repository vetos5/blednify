import { describe, expect, test } from 'bun:test';

import { heldConfirm } from '../src/ui/held';

describe('heldConfirm', () => {
  test('nothing has a copy: a destructive Remove that warns about likes and playlists', () => {
    const c = heldConfirm({ held: 30, heldFolders: ['mnt'] });
    expect(c.title).toBe('30 songs missing on the server');
    expect(c.destructive).toBe(true);
    expect(c.confirmLabel).toBe('Remove');
    expect(c.message).toContain('Removing them also takes them out of likes and playlists');
    expect(c.message).toContain('Missing from: mnt');
  });

  test('every held song has a copy: a calm confirm that says they move, nothing is lost', () => {
    const c = heldConfirm({ held: 30, heldWithCopy: 30 });
    expect(c.destructive).toBe(false);
    expect(c.confirmLabel).toBe('Use the copies');
    expect(c.message).toContain('likes and playlists keep them');
    expect(c.message).not.toContain('removed');
  });

  test('some have a copy: the sheet gives both counts', () => {
    const c = heldConfirm({ held: 30, heldWithCopy: 28, heldFolders: ['', 'a', 'b', 'c', 'd'] });
    expect(c.destructive).toBe(true);
    expect(c.message).toContain('28 songs have an identical copy');
    expect(c.message).toContain('the other 2 songs will be removed');
    expect(c.message).toContain('Missing from: the music folder itself, a, b, c, d, …');
  });

  test('a bad count from the server never claims more copies than held songs', () => {
    expect(heldConfirm({ held: 2, heldWithCopy: 5 }).destructive).toBe(false);
    expect(heldConfirm({ held: 2, heldWithCopy: -1 }).destructive).toBe(true);
    expect(heldConfirm({ held: 1, heldWithCopy: 1 }).title).toBe('1 song missing on the server');
  });
});
