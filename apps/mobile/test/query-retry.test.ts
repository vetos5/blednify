import { describe, expect, test } from 'bun:test';

import { shouldRetryQuery } from '../src/core/query-retry';

const http = (status: number) => ({ status, message: `HTTP ${status}` });
const dropped = { status: null, message: "Couldn't reach the server" };

describe('shouldRetryQuery', () => {
  test('one retry at most', () => {
    expect(shouldRetryQuery(0, dropped, false)).toBe(true);
    expect(shouldRetryQuery(1, dropped, false)).toBe(false);
  });
  test('a refused token or a missing song is final; a tunnel 502 is retried', () => {
    expect(shouldRetryQuery(0, http(401), false)).toBe(false);
    expect(shouldRetryQuery(0, http(404), false)).toBe(false);
    expect(shouldRetryQuery(0, http(502), false)).toBe(true);
  });
  test('no second try into a server that is known to be down (offline: no 1 s echo of every query)', () => {
    expect(shouldRetryQuery(0, dropped, true)).toBe(false);
    expect(shouldRetryQuery(0, new Error('fetch failed'), true)).toBe(false);
    expect(shouldRetryQuery(0, http(503), true)).toBe(true);
  });
});
