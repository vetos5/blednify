import { describe, expect, test } from 'bun:test';

import { nowPlayingLabel } from '../src/ui/now-playing-label';

describe('nowPlayingLabel', () => {
  test('native says what it is first', () => {
    expect(nowPlayingLabel('Lurk', 'Ghost', false)).toBe('Now playing: Lurk by Ghost. Open player');
  });
  test('web starts with the visible title and artist, in order (label in name)', () => {
    const label = nowPlayingLabel('Lurk', 'Ghost', true);
    expect(label.startsWith('Lurk, Ghost')).toBe(true);
    expect(label).toContain('Now playing');
    expect(label).toContain('open player');
  });
});
