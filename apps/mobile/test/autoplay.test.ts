import { describe, expect, test } from 'bun:test';

import {
  AUTOPLAY_BATCH,
  autoplayWanted,
  planAutoplay,
  promoteAuto,
  restoredAutoFrom,
  shuffleChosen,
  type Candidate,
} from '../src/core/player/autoplay';
import { upcoming } from '../src/core/player/upcoming';

const t = (key: string, artist: string, album: string, albumId = album, artistId = artist): Candidate => ({
  key,
  artist,
  artistId,
  album,
  albumId,
});
const keep = <T,>(xs: readonly T[]) => xs.slice();
const reverse = <T,>(xs: readonly T[]) => xs.slice().reverse();
const keyOf = (name: string) => name.toLowerCase().replace(/\s+/g, '');
const keys = (xs: readonly Candidate[]) => xs.map((x) => x.key);

describe('autoplayWanted', () => {
  const on = { enabled: true, repeatOff: true };
  test('a single song gets a full batch at once', () => {
    expect(autoplayWanted({ ...on, index: 0, length: 1, autoFrom: 1 })).toBe(AUTOPLAY_BATCH);
  });
  test('a long album only when it is about to run out', () => {
    expect(autoplayWanted({ ...on, index: 0, length: 12, autoFrom: 12 })).toBe(0);
    expect(autoplayWanted({ ...on, index: 9, length: 12, autoFrom: 12 })).toBe(0);
    expect(autoplayWanted({ ...on, index: 10, length: 12, autoFrom: 12 })).toBe(AUTOPLAY_BATCH);
  });
  test('tops up when the autoplay songs run low, not before', () => {
    expect(autoplayWanted({ ...on, index: 0, length: 11, autoFrom: 1 })).toBe(0);
    expect(autoplayWanted({ ...on, index: 0, length: 3, autoFrom: 1 })).toBe(AUTOPLAY_BATCH - 2);
  });
  test('never with repeat on, autoplay off, or nothing playing', () => {
    expect(autoplayWanted({ enabled: true, repeatOff: false, index: 0, length: 1, autoFrom: 1 })).toBe(0);
    expect(autoplayWanted({ enabled: false, repeatOff: true, index: 0, length: 1, autoFrom: 1 })).toBe(0);
    expect(autoplayWanted({ ...on, index: -1, length: 0, autoFrom: 0 })).toBe(0);
  });
});

describe('promoteAuto / restoredAutoFrom', () => {
  test('an autoplay song that starts playing joins the queue', () => {
    expect(promoteAuto(0, 1, 11)).toBe(1);
    expect(promoteAuto(1, 1, 11)).toBe(2);
    expect(promoteAuto(4, 1, 11)).toBe(5);
    expect(promoteAuto(-1, 0, 0)).toBe(0);
  });
  test('restore reads the saved tail count, and nothing from older saves or bad values', () => {
    expect(restoredAutoFrom(11, 10, 0)).toBe(1);
    expect(restoredAutoFrom(11, undefined, 0)).toBe(11);
    expect(restoredAutoFrom(11, -3, 0)).toBe(11);
    expect(restoredAutoFrom(11, 2.5, 0)).toBe(11);
    expect(restoredAutoFrom(3, 99, 0)).toBe(1);
  });
});

describe('queue sections', () => {
  test('Up next holds what the user chose; Autoplay follows it', () => {
    // [song, queued, auto1, auto2]
    expect(upcoming(0, 4, false, 2)).toEqual({ ahead: [1], wrapped: [], autoplay: [2, 3] });
    expect(upcoming(0, 3, false, 1)).toEqual({ ahead: [], wrapped: [], autoplay: [1, 2] });
  });
});

describe('shuffleChosen', () => {
  test('keeps the current song first and the autoplay tail last, in order', () => {
    const orig = ['a', 'b', 'c', 'x', 'y'];
    expect(shuffleChosen(orig, 'b', 2, reverse)).toEqual(['b', 'c', 'a', 'x', 'y']);
    expect(shuffleChosen(orig, 'a', 0, reverse)).toEqual(['a', 'y', 'x', 'c', 'b']);
  });
});

describe('planAutoplay', () => {
  const seed = t('s', 'Muse', 'Absolution');
  const library = [
    t('l1', 'Queen', 'Jazz'),
    t('m1', 'Muse', 'Origin'),
    t('c1', 'Various', 'Absolution', 'Absolution', 'Various'),
    t('l2', 'Queen', 'Innuendo'),
  ];
  test('same artist, then same album, then the rest; the seed and the queue left out', () => {
    const artist = [seed, t('m2', 'Muse', 'Drones'), t('m3', 'Muse', 'Absolution')];
    const out = planAutoplay({ seed, artist, album: [seed], library, exclude: new Set(['l2']), limit: 10, shuffle: keep, keyOf });
    expect(keys(out)).toEqual(['m2', 'm3', 'm1', 'c1', 'l1']);
  });
  test('no song twice even when it is in several groups', () => {
    const dup = t('m2', 'Muse', 'Drones');
    const out = planAutoplay({ seed, artist: [dup], album: [dup], library: [dup, ...library], exclude: new Set(), limit: 10, shuffle: keep, keyOf });
    expect(new Set(keys(out)).size).toBe(out.length);
    expect(keys(out)).not.toContain('s');
  });
  test('offline: the device library alone still finds the artist by name spelling', () => {
    const local = [t('d1', 'MUSE', 'Drones', 'l:x', 'l:muse'), t('d2', 'Queen', 'Jazz', 'l:y', 'l:queen')];
    const out = planAutoplay({ seed, artist: [], album: [], library: local, exclude: new Set(), limit: 10, shuffle: keep, keyOf });
    expect(keys(out)).toEqual(['d1', 'd2']);
  });
  test('each group is shuffled on its own and the limit holds', () => {
    const artist = [t('m1', 'Muse', 'A'), t('m2', 'Muse', 'B')];
    const out = planAutoplay({ seed, artist, album: [], library, exclude: new Set(), limit: 3, shuffle: reverse, keyOf });
    expect(keys(out)).toEqual(['m2', 'm1', 'c1']);
    expect(planAutoplay({ seed, artist, album: [], library, exclude: new Set(), limit: 0, shuffle: keep, keyOf })).toEqual([]);
  });
});
