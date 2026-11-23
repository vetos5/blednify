import { describe, expect, test } from 'bun:test';

import {
  errorPlan,
  playButtonLabel,
  playButtonMode,
  publishedPlayState,
  retrySeekMs,
  stallAction,
  statusSetsPosition,
} from '../src/core/player/stall';

const base = { current: true, nativePlaying: false, streams: true, quiet: true };

describe('stallAction (watchdog fired before the song started)', () => {
  test('nothing to do once the user moved on or paused', () => {
    expect(stallAction({ ...base, current: false })).toBe('none');
  });
  test('native was playing all along (JS throttled)', () => {
    expect(stallAction({ ...base, nativePlaying: true })).toBe('started');
  });
  test('a streamed song asks the server before touching the player', () => {
    expect(stallAction(base)).toBe('probe');
    expect(stallAction({ ...base, quiet: false })).toBe('probe');
  });
  test('hung connection (server silent): a network failure, never a new player', () => {
    expect(stallAction({ ...base, serverAnswers: false })).toBe('network-error');
    expect(stallAction({ ...base, quiet: false, serverAnswers: false })).toBe('network-error');
  });
  test('server answers: the player is what is stuck, first quietly, then reported', () => {
    expect(stallAction({ ...base, serverAnswers: true })).toBe('reload-new-player');
    expect(stallAction({ ...base, quiet: false, serverAnswers: true })).toBe('report-recreate');
  });
  test('a downloaded song never waits on the network', () => {
    expect(stallAction({ ...base, streams: false })).toBe('reload-new-player');
    expect(stallAction({ ...base, streams: false, quiet: false })).toBe('report-recreate');
  });
});

describe('errorPlan', () => {
  const e = { network: true, wantPlay: true, recreate: false, web: false, errorsSincePlaying: 3 };
  test('a dropped connection retries in the same player however many errors came before', () => {
    expect(errorPlan(e)).toEqual({ retrying: true, natBroken: false });
  });
  test('the watchdog asking for a new player gets one', () => {
    expect(errorPlan({ ...e, recreate: true })).toEqual({ retrying: true, natBroken: true });
  });
  test('web is always recreated', () => {
    expect(errorPlan({ ...e, web: true }).natBroken).toBe(true);
  });
  test('song errors: the first keeps the player, a second before playing recreates it', () => {
    expect(errorPlan({ ...e, network: false, errorsSincePlaying: 0 })).toEqual({ retrying: false, natBroken: false });
    expect(errorPlan({ ...e, network: false, errorsSincePlaying: 1 })).toEqual({ retrying: false, natBroken: true });
  });
  test('paused: a network error is reported, not retried', () => {
    expect(errorPlan({ ...e, wantPlay: false, errorsSincePlaying: 0 })).toEqual({ retrying: false, natBroken: false });
  });
});

describe('publishedPlayState (what the play button shows)', () => {
  const s = { nativePlaying: false, nativeBuffering: false, isLoaded: true, wantPlay: true, retrying: false };
  test('a retry stays busy through both halves of every attempt', () => {
    // Native between attempts: re-prepared and buffering, "playing" by intent...
    expect(publishedPlayState({ ...s, retrying: true, nativePlaying: true, nativeBuffering: true, isLoaded: false })).toEqual({
      isPlaying: false,
      isBuffering: true,
    });
    // ...and idle after the next error.
    expect(publishedPlayState({ ...s, retrying: true, isLoaded: false })).toEqual({ isPlaying: false, isBuffering: true });
  });
  test('paused during a retry: plain Play, never busy', () => {
    expect(publishedPlayState({ ...s, retrying: true, wantPlay: false, isLoaded: false })).toEqual({ isPlaying: false, isBuffering: false });
  });
  test('without a retry native is read as it is', () => {
    expect(publishedPlayState({ ...s, nativePlaying: true })).toEqual({ isPlaying: true, isBuffering: false });
    expect(publishedPlayState({ ...s, nativePlaying: true, nativeBuffering: true })).toEqual({ isPlaying: true, isBuffering: true });
    expect(publishedPlayState({ ...s, isLoaded: false })).toEqual({ isPlaying: false, isBuffering: true });
    expect(publishedPlayState({ ...s, wantPlay: false, isLoaded: false })).toEqual({ isPlaying: false, isBuffering: false });
  });
});

describe('playButtonMode / playButtonLabel', () => {
  test('one steady busy state and label for the whole retry', () => {
    for (const isPlaying of [true, false])
      for (const isBuffering of [true, false]) {
        const mode = playButtonMode({ isPlaying, isBuffering, retrying: true });
        expect(mode).toBe('busy');
        expect(playButtonLabel(mode, true)).toBe('Reconnecting, pause');
      }
  });
  test('loading, playing (a short re-buffer keeps Pause), paused', () => {
    expect(playButtonLabel(playButtonMode({ isPlaying: false, isBuffering: true, retrying: false }), false)).toBe('Loading, pause');
    expect(playButtonMode({ isPlaying: true, isBuffering: true, retrying: false })).toBe('pause');
    expect(playButtonMode({ isPlaying: false, isBuffering: false, retrying: false })).toBe('play');
  });
});

describe('the place in a song survives a dropped connection', () => {
  test('only a loaded player moves the published position', () => {
    expect(statusSetsPosition({ isLoaded: true, seekGuarded: false })).toBe(true);
    // Re-preparing after an error, or a rebuilt window not loaded yet: it reports 0.
    expect(statusSetsPosition({ isLoaded: false, seekGuarded: false })).toBe(false);
    expect(statusSetsPosition({ isLoaded: true, seekGuarded: true })).toBe(false);
  });
  test('a player that had loaded the song keeps its own position', () => {
    expect(retrySeekMs({ curLoaded: true, pendingSeekMs: null, publishedMs: 198_000 })).toBeNull();
  });
  test('load at 3:18, error before it loaded, retry: seeks back to 3:18', () => {
    // Pause then Play during an outage, or Play on a restored session with the server down.
    expect(retrySeekMs({ curLoaded: false, pendingSeekMs: 198_000, publishedMs: 198_000 })).toBe(198_000);
    // The pending seek was already handed to an earlier retry: the published position still holds the place.
    expect(retrySeekMs({ curLoaded: false, pendingSeekMs: null, publishedMs: 198_000 })).toBe(198_000);
  });
  test('a song that was starting from the top needs no seek', () => {
    expect(retrySeekMs({ curLoaded: false, pendingSeekMs: null, publishedMs: 0 })).toBeNull();
  });
});
