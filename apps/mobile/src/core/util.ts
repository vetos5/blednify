import { randomUUID } from 'expo-crypto';

/** FNV-1a over UTF-16 code units or bytes. */
function fnv1a(input: string | Uint8Array, seed: number): number {
  let h = seed >>> 0;
  const len = input.length;
  for (let i = 0; i < len; i++) {
    h ^= typeof input === 'string' ? input.charCodeAt(i) : input[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/**
 * Matching key of an artist name: case, accents, punctuation and spacing are ignored, ё = е (й stays й).
 * Same rule as the server (apps/server/src/artists.ts nameKey).
 */
export function artistKey(name: string): string {
  const s = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/й/g, '\u0001')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\u0001/g, 'й');
  return s.replace(/[^\p{L}\p{N}]+/gu, '') || s.replace(/\s+/g, ' ').trim();
}

/** Id of an on-device artist: spellings with the same `artistKey` are one artist. */
export const localArtistId = (name: string) => `l:${hashHex(artistKey(name))}`;

/** Fast non-cryptographic 64-bit-ish hex hash (two FNV-1a lanes). */
export function hashHex(input: string | Uint8Array): string {
  return hex8(fnv1a(input, 0x811c9dc5)) + hex8(fnv1a(input, 0x050c5d1f));
}

/** 16 hex chars, random. */
export function randomId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export function shuffled<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') return e.message;
  return 'Unknown error';
}

const MIME_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
};

const EXT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
};

export const extForMime = (mime: string | null | undefined): string =>
  (mime && MIME_EXT[mime.toLowerCase().split(';')[0].trim()]) || 'audio';

export const mimeForExt = (ext: string): string => EXT_MIME[ext.toLowerCase()] ?? 'application/octet-stream';

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}
