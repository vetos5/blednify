// The saved play queue: round trip of the compact rows. Device modules are stubbed.
import { describe, expect, mock, test } from 'bun:test';

const BASE = 'https://music.example.com';
mock.module('../src/core/settings', () => ({
  getServerBase: () => BASE,
  useServerBase: () => BASE,
  normalizeServerUrl: (u: string) => u,
  settingsStore: { getState: () => ({ serverUrl: BASE, accessToken: '' }), subscribe: () => () => {} },
  kv: { getString: () => undefined, set: () => {}, remove: () => {} },
}));
mock.module('../src/core/lib-index', () => {
  const state = { ready: true, liked: new Set(), downloads: new Map() };
  return { libIndex: { getState: () => state, setState: () => {}, subscribe: () => () => {} } };
});
mock.module('../src/core/paths', () => ({
  absUri: (rel: string | null) => (rel ? `file:///docs/${rel}` : null),
  relUri: (abs: string | null) => (abs ? abs.replace('file:///docs/', '') : null),
}));
mock.module('../src/core/auth', () => ({ authHeadersFor: () => ({}) }));

const { fromRow, toRow } = await import('../src/core/player/queue-rows');

const remote = {
  key: 'r:abc123',
  id: 'abc123',
  origin: 'remote' as const,
  title: 'Halo',
  artist: 'Beyoncé',
  album: 'I Am',
  albumId: 'al1',
  artistId: 'ar1',
  durationMs: 261000,
  trackNumber: 1,
  discNumber: null,
  year: 2008,
  genre: 'Pop',
  mimeType: 'audio/flac',
  sizeBytes: 31_000_000,
  artworkUri: `${BASE}/api/tracks/abc123/artwork`,
  streamUri: `${BASE}/api/tracks/abc123/stream`,
  localUri: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  edited: true,
  bitrate: 950,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  lossless: true,
};

describe('queue rows', () => {
  test('a server track survives the round trip (URIs rebuilt from the id)', () => {
    const back = fromRow(JSON.parse(JSON.stringify(toRow(remote))), BASE);
    expect(back).toEqual(remote);
  });

  test('rows that are not rows are dropped, not crashed on', () => {
    for (const r of [null, 5, 'x', [], [1], ['x:bad'], ['zz:abc']]) expect(fromRow(r, BASE)).toBeNull();
  });
});
