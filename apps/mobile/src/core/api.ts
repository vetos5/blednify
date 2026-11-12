/** Server contract types — mirror of docs/API.md (v1). */
import { settingsStore } from './settings';

export type ApiTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId: string;
  durationMs: number;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  mimeType: string;
  sizeBytes: number;
  bitrate: number | null;
  hasArtwork: boolean;
  addedAt: string;
  /** The admin changed title/artist/album on the server (older servers omit it). */
  edited?: boolean;
};
export type ApiAlbum = {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  year: number | null;
  trackCount: number;
  durationMs: number;
  artworkTrackId: string | null;
};
export type ApiArtist = {
  id: string;
  name: string;
  /** Other spellings shown as this artist (older servers omit it). */
  aliases?: string[];
  /** Other artists were merged into it by the admin. */
  merged?: boolean;
  albumCount: number;
  trackCount: number;
  artworkTrackId: string | null;
};
export type ApiPage<T> = { items: T[]; total: number; limit: number; offset: number };
export type ApiHealth = { ok: boolean; name: string; version: string; trackCount?: number; authRequired?: boolean };
export type ApiSearch = { tracks: ApiTrack[]; albums: ApiAlbum[]; artists: ApiArtist[] };

const DEFAULT_TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Plain-language reason for a server URL that can't work, or null when it looks fine. */
export function serverUrlProblem(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  if (!m) return 'Enter an address like https://music.example.com';
  if (!/^https?$/i.test(m[1])) return 'The address must start with http:// or https://';
  if (!m[2]) return 'The address is missing a host name';
  return null;
}

/**
 * Turns low-level fetch failures (expo/fetch's "fetch failed: … Caused by: java.net…",
 * "Network request failed", TLS errors) into a short message a person can act on.
 * The raw error is logged for debugging.
 */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const raw = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e);
  console.warn('[api] request failed:', raw);
  const has = (re: RegExp) => re.test(raw);
  if (has(/MalformedURL|unknown protocol|invalid url|cannot be cast to type class java\.net\.URL/i))
    return new ApiError('The server address is not valid');
  if (has(/UnknownHost|Unable to resolve host|ENOTFOUND|No address associated/i))
    return new ApiError("Couldn't find that server — check the address");
  if (has(/ConnectException|ECONNREFUSED|Failed to connect|Connection refused/i))
    return new ApiError("Couldn't connect — is the server running?");
  if (has(/SSL|TLS|certificate|CertPath|handshake/i)) return new ApiError('Secure connection failed — check https and the certificate');
  if (has(/Cleartext HTTP traffic|CLEARTEXT/i)) return new ApiError('This server needs https://');
  if (has(/timeout|timed out|SocketTimeout/i)) return new ApiError('Server did not respond in time');
  if (has(/JSON Parse|Unexpected token|not valid JSON/i)) return new ApiError("That address didn't answer like a Blednify server");
  return new ApiError("Couldn't reach the server — check the address and your connection");
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** GET JSON from `${base}${path}` with a hard timeout; honours an outer AbortSignal (react-query). */
export async function apiGet<T>(
  base: string,
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  token: string = settingsStore.getState().accessToken,
): Promise<T> {
  if (!base) throw new ApiError('No server configured');
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { signal: ctrl.signal, headers });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Non-JSON error body; keep the status text.
      }
      throw new ApiError(message, res.status);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (timedOut) throw new ApiError('Server did not respond in time');
    if (signal?.aborted) throw e;
    throw toApiError(e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const seg = encodeURIComponent;
export const trackStreamUrl = (base: string, id: string) => `${base}/api/tracks/${seg(id)}/stream`;
export const trackArtworkUrl = (base: string, id: string) => `${base}/api/tracks/${seg(id)}/artwork`;

/** The server's resize buckets (apps/server/src/artwork.ts). Asking for exactly these lets nearby sizes share a cached image. */
const ARTWORK_SIZES = [64, 128, 256, 512, 1024] as const;

/**
 * A server cover scaled down for a slot `px` device pixels wide. Downloaded files, other image endpoints
 * and already sized URLs are unchanged.
 */
export function sizedArtworkUrl(uri: string, px: number): string {
  if (!/^https?:\/\//i.test(uri) && !uri.startsWith('/')) return uri;
  if (!/\/api\/tracks\/[^/?#]+\/artwork$/.test(uri)) return uri;
  return `${uri}?size=${ARTWORK_SIZES.find((s) => s >= px) ?? ARTWORK_SIZES[ARTWORK_SIZES.length - 1]}`;
}
