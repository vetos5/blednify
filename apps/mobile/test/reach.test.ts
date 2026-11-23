import { describe, expect, test } from 'bun:test';

import { backOnlineVerdict, offlineVerdict, probeRetriesNow } from '../src/core/player/reach';

const wifi = { isConnected: true, isInternetReachable: true, type: 'WIFI' };
const cell = { isConnected: true, isInternetReachable: true, type: 'CELLULAR' };
const none = { isConnected: false, isInternetReachable: false, type: 'NONE' };

describe('offlineVerdict (a streamed song failed on the network)', () => {
  test('no connection is offline for any server', () => {
    expect(offlineVerdict(none, false)).toBe('offline');
    expect(offlineVerdict(none, true)).toBe('offline');
  });

  test('an internet server follows the phone’s internet reachability', () => {
    expect(offlineVerdict(wifi, false)).toBe('online');
    expect(offlineVerdict({ ...wifi, isInternetReachable: false }, false)).toBe('offline');
    expect(offlineVerdict({ ...wifi, isInternetReachable: null }, false)).toBe('online');
  });

  test('a LAN server on mobile data is asked; on Wi-Fi the song is retried in place', () => {
    expect(offlineVerdict(cell, true)).toBe('probe');
    expect(offlineVerdict(wifi, true)).toBe('online');
    // Home Wi-Fi without internet says nothing about a LAN server.
    expect(offlineVerdict({ ...wifi, isInternetReachable: false }, true)).toBe('online');
  });
});

describe('backOnlineVerdict (playing only downloads)', () => {
  test('an internet server needs the internet to answer, not just a connection', () => {
    expect(backOnlineVerdict(wifi, false)).toBe('online');
    expect(backOnlineVerdict({ ...wifi, isInternetReachable: null }, false)).toBe('offline');
    expect(backOnlineVerdict(none, false)).toBe('offline');
  });

  test('a LAN server must answer itself: turning mobile data on is not enough', () => {
    expect(backOnlineVerdict(cell, true)).toBe('probe');
    expect(backOnlineVerdict(wifi, true)).toBe('probe');
    expect(backOnlineVerdict(none, true)).toBe('offline');
    expect(backOnlineVerdict({ isConnected: null }, true)).toBe('offline');
  });
});

describe('probeRetriesNow (server probe during a network retry)', () => {
  test('the server coming back retries at once', () => {
    expect(probeRetriesNow({ answers: true, answeredBefore: false, waiting: true })).toBe(true);
  });
  test('still down, or an attempt already under way: nothing', () => {
    expect(probeRetriesNow({ answers: false, answeredBefore: false, waiting: true })).toBe(false);
    expect(probeRetriesNow({ answers: true, answeredBefore: false, waiting: false })).toBe(false);
  });
  test('answering health while the stream keeps failing leaves it to the backoff', () => {
    expect(probeRetriesNow({ answers: true, answeredBefore: true, waiting: true })).toBe(false);
  });
});
