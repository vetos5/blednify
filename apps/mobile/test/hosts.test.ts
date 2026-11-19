// isLocalHost / normalizeServerUrl decide whether a token may travel over plain http.
import { describe, expect, test } from 'bun:test';

import { isCleartextPublic, isLocalHost, normalizeServerUrl } from '../src/core/hosts';

describe('isLocalHost', () => {
  test.each([
    'localhost:8787',
    'nas',
    'music.local',
    '192.168.1.5:8787',
    '10.0.0.2',
    '100.101.102.103',
    '[::1]:8787',
    '[fe80::1%wlan0]:8787',
    '[fd7a:115c:a1e0::5]:8787',
    '[fc00::1]',
    '[::ffff:192.168.1.2]:80',
  ])('%s is local', (h) => expect(isLocalHost(h)).toBe(true));

  test.each(['music.example.com', '8.8.8.8:8787', '[2001:db8::5]:8787', '[2a01:4f8::1]', '[::ffff:8.8.8.8]', '[fe8::1]'])(
    '%s is public',
    (h) => expect(isLocalHost(h)).toBe(false),
  );
});

test('schemeless public IPv6 gets https; cleartext to it is flagged', () => {
  expect(normalizeServerUrl('[2001:db8::5]:8787')).toBe('https://[2001:db8::5]:8787');
  expect(normalizeServerUrl('[fd7a:115c:a1e0::5]:8787')).toBe('http://[fd7a:115c:a1e0::5]:8787');
  expect(isCleartextPublic('http://[2001:db8::5]:8787')).toBe(true);
});
