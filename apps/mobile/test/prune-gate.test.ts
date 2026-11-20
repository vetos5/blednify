import { describe, expect, test } from 'bun:test';

import { pruneGate, type PruneGateState } from '../src/core/prune-gate';

const streamed = { origin: 'remote', localUri: null };
const downloaded = { origin: 'remote', localUri: 'file:///a.mp3' };
const base: PruneGateState = { errorId: 0, isPlaying: false, retrying: false, current: streamed };

describe('pruneGate', () => {
  test('a streamed song failing arms the check; it runs once a streamed song plays', () => {
    const failed = { ...base, errorId: 1 };
    expect(pruneGate(false, failed, base)).toEqual({ armed: true, runNow: false });
    const playing = { ...failed, isPlaying: true };
    expect(pruneGate(true, playing, failed)).toEqual({ armed: false, runNow: true });
    // Once only.
    expect(pruneGate(false, { ...playing }, playing)).toEqual({ armed: false, runNow: false });
  });

  test('a network failure (retrying) never arms it: no requests into a dead server', () => {
    const lost = { ...base, errorId: 1, retrying: true };
    expect(pruneGate(false, lost, base)).toEqual({ armed: false, runNow: false });
    // Next songs keep failing the same way while offline.
    const again = { ...lost, errorId: 2 };
    expect(pruneGate(false, again, lost)).toEqual({ armed: false, runNow: false });
  });

  test('playing a download does not prove the server is up', () => {
    const failed = { ...base, errorId: 1 };
    const offline = { ...failed, isPlaying: true, current: downloaded };
    expect(pruneGate(true, offline, failed)).toEqual({ armed: true, runNow: false });
    const backOnline = { ...offline, current: streamed };
    expect(pruneGate(true, backOnline, offline)).toEqual({ armed: false, runNow: true });
  });

  test('a download failing does not arm it', () => {
    const failed = { ...base, errorId: 1, current: downloaded };
    expect(pruneGate(false, failed, { ...base, current: downloaded })).toEqual({ armed: false, runNow: false });
  });

  test('still retrying while it plays is not proof', () => {
    expect(pruneGate(true, { ...base, isPlaying: true, retrying: true }, base)).toEqual({ armed: true, runNow: false });
  });
});
