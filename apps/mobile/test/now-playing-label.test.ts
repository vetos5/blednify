import { describe, expect, test } from 'bun:test';

import { nowPlayingLabel, trackRowLabel } from '../src/ui/now-playing-label';

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

describe('trackRowLabel', () => {
  test('native keeps the descriptive label', () => {
    expect(trackRowLabel('Lurk', 'Ghost', 0, false)).toBe('Lurk by Ghost');
    expect(trackRowLabel('Lurk', 'Ghost', 2, false)).toBe('Lurk by Ghost, now playing');
  });
  test('web starts with the visible title then artist and keeps the play state', () => {
    expect(trackRowLabel('Lurk', 'Ghost', 0, true)).toBe('Lurk, Ghost');
    expect(trackRowLabel('Lurk', 'Ghost', 1, true)).toBe('Lurk, Ghost, paused');
    expect(trackRowLabel('Lurk', 'Ghost', 2, true)).toBe('Lurk, Ghost, now playing');
  });
});
