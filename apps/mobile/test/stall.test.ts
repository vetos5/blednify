import { describe, expect, test } from 'bun:test';

import { errorPlan, stallAction } from '../src/core/player/stall';

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
