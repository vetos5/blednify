import { describe, expect, test } from 'bun:test';

import { connectionLabel, connectionOf, unreachablePrefix } from '../src/core/connection-state';

const base = { hasServer: true, online: false, loading: false, needsToken: false, phoneOffline: false };

describe('connectionOf', () => {
  test('no server is a local library whatever the network says', () => {
    expect(connectionOf({ ...base, hasServer: false, phoneOffline: true })).toBe('none');
  });
  test('a server that answers is online even if the OS reports no connection (LAN, tether)', () => {
    expect(connectionOf({ ...base, online: true, phoneOffline: true })).toBe('online');
  });
  test('the phone being offline wins over loading, a missing token and an unreachable server', () => {
    expect(connectionOf({ ...base, phoneOffline: true })).toBe('phone-offline');
    expect(connectionOf({ ...base, phoneOffline: true, loading: true })).toBe('phone-offline');
    expect(connectionOf({ ...base, phoneOffline: true, needsToken: true })).toBe('phone-offline');
  });
  test('online phone: connecting, then token, then server offline', () => {
    expect(connectionOf({ ...base, loading: true })).toBe('connecting');
    expect(connectionOf({ ...base, needsToken: true })).toBe('needs-token');
    expect(connectionOf(base)).toBe('server-offline');
  });
});

describe('connectionLabel', () => {
  test('the pill never says "Server offline" when the phone is offline', () => {
    expect(connectionLabel('phone-offline', 0, { downloads: true })).toBe('Offline · downloads still play');
    expect(connectionLabel('phone-offline', 0, { downloads: false })).toBe('You’re offline');
    expect(connectionLabel('phone-offline', 0, { short: true })).toBe('You’re offline');
  });
  test('online shows the song count', () => {
    expect(connectionLabel('online', 1220)).toBe(`Server · ${(1220).toLocaleString()} songs`);
    expect(connectionLabel('online', 1, { short: true })).toBe('1 song');
  });
  test('other states', () => {
    expect(connectionLabel('none', 0)).toBe('Local library');
    expect(connectionLabel('none', 0, { short: true })).toBe('No server');
    expect(connectionLabel('needs-token', 0)).toBe('Server needs a token');
    expect(connectionLabel('server-offline', 0)).toBe('Server offline');
  });
});

describe('unreachablePrefix', () => {
  test('refused is about the token, offline depends on the phone', () => {
    expect(unreachablePrefix('refused', true)).toBe('Access token refused');
    expect(unreachablePrefix('offline', true)).toBe('You’re offline');
    expect(unreachablePrefix('offline', false)).toBe('Server offline');
  });
});
