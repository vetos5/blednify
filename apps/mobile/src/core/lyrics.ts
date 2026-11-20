import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { useStore } from 'zustand';

import { apiGet } from './api';
import { openReader } from './import/importer';
import { progressStore } from './player/store';
import { readTags } from './import/tags';
import { settingsStore, useServerBase } from './settings';
import type { AppTrack } from './types';

export type LyricLine = { timeMs: number; text: string };
export type Lyrics = {
  /** Time-synced lines sorted by time, or null when only plain text is known. */
  synced: LyricLine[] | null;
  /** Plain text with "\n" line breaks. */
  plain: string | null;
  /** The track is known to have no vocals. */
  instrumental: boolean;
  source: 'file' | 'embedded' | 'lrclib' | null;
};

const NONE: Lyrics = { synced: null, plain: null, instrumental: false, source: null };

/** Lyrics are kept apart from settings: a few KB each, read back when the server is unreachable. */
const cache = createMMKV({ id: 'blednify-lyrics' });
const MISS_RETRY_MS = 7 * 86_400_000;
const LRCLIB = 'https://lrclib.net';
const ONLINE_TIMEOUT_MS = 8_000;

type Cached = { at: number; lyrics: Lyrics };

function readCache(key: string): Cached | null {
  const raw = cache.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Cached;
  } catch {
    return null;
  }
}

/** Entries kept. On web the cache lives in localStorage (about 5 MB per site, shared with the player). */
const CACHE_CAP = Platform.OS === 'web' ? 300 : 3000;
let writesSincePrune = Number.POSITIVE_INFINITY;

/** Drops the oldest entries once the cache passes its cap (checked on the first write, then every 50). */
function pruneCache() {
  writesSincePrune = 0;
  const keys = cache.getAllKeys();
  if (keys.length <= CACHE_CAP) return;
  const aged = keys.map((k) => ({ k, at: readCache(k)?.at ?? 0 })).sort((a, b) => a.at - b.at);
  for (const { k } of aged.slice(0, keys.length - Math.floor(CACHE_CAP * 0.8))) cache.remove(k);
}

function writeCache(key: string, lyrics: Lyrics) {
  if (++writesSincePrune > 50) pruneCache();
  cache.set(key, JSON.stringify({ at: Date.now(), lyrics } satisfies Cached));
}

export const hasLyrics = (l: Lyrics | null | undefined): boolean => !!(l && (l.synced?.length || l.plain));

// --- LRC -------------------------------------------------------------------------------------

const LINE_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;

/** Parses LRC (multi-time lines, `[offset:]`, enhanced `<mm:ss>` word tags stripped). Null without timed lines. */
export function parseLrc(text: string): LyricLine[] | null {
  let offset = 0;
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    const times: number[] = [];
    let rest = raw.trimStart();
    for (let m = LINE_TAG.exec(rest); m; m = LINE_TAG.exec(rest)) {
      times.push(Number(m[1]) * 60_000 + Number(m[2]) * 1000 + (m[3] ? Number(m[3].padEnd(3, '0')) : 0));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue;
    const line = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const t of times) out.push({ timeMs: Math.max(0, t - offset), text: line });
  }
  if (!out.some((l) => l.text)) return null;
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

function lyricsFromText(text: string, source: Lyrics['source']): Lyrics | null {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return null;
  const synced = /^\s*\[\d{1,3}:\d{1,2}/m.test(t) ? parseLrc(t) : null;
  if (synced) return { synced, plain: synced.map((l) => l.text).join('\n').trim(), instrumental: false, source };
  return { synced: null, plain: t.replace(/\r\n?/g, '\n'), instrumental: false, source };
}

/** Index of the line being sung at `positionMs` (-1 before the first line). */
export function activeLyricIndex(lines: readonly LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// --- Sources ---------------------------------------------------------------------------------

async function fromFile(uri: string): Promise<Lyrics | null> {
  const f = new File(uri);
  if (!f.exists) return null;
  const reader = openReader(f);
  try {
    const tags = await readTags(reader);
    return tags.lyrics ? lyricsFromText(tags.lyrics, 'embedded') : null;
  } catch {
    return null;
  } finally {
    reader.close();
  }
}

type LrclibHit = { instrumental?: boolean; plainLyrics?: string | null; syncedLyrics?: string | null; duration?: number };

/** Direct LRCLIB lookup for imported tracks (server tracks go through the server, which caches for everyone). */
async function fromLrclib(t: AppTrack): Promise<Lyrics | null> {
  if (!t.title || t.artist === 'Unknown Artist') return null;
  const get = async (path: string, params: Record<string, string>) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ONLINE_TIMEOUT_MS);
    try {
      return await fetch(`${LRCLIB}${path}?${qs}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } finally {
      clearTimeout(timer);
    }
  };
  const params: Record<string, string> = { artist_name: t.artist, track_name: t.title };
  if (t.album && t.album !== 'Unknown Album') params.album_name = t.album;
  if (t.durationMs > 0) params.duration = String(Math.round(t.durationMs / 1000));
  const res = await get('/api/get', params);
  let hit: LrclibHit | null = null;
  if (res.ok) hit = (await res.json()) as LrclibHit;
  else if (res.status !== 404) throw new Error(`lrclib HTTP ${res.status}`);
  if (!hit) {
    const s = await get('/api/search', { artist_name: t.artist, track_name: t.title });
    if (!s.ok) throw new Error(`lrclib HTTP ${s.status}`);
    const target = t.durationMs / 1000;
    hit =
      ((await s.json()) as LrclibHit[])
        .filter((h) => !target || (typeof h.duration === 'number' && Math.abs(h.duration - target) <= 5))
        .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))[0] ?? null;
  }
  if (!hit) return null;
  if (hit.instrumental) return { ...NONE, instrumental: true, source: 'lrclib' };
  const synced = hit.syncedLyrics ? lyricsFromText(hit.syncedLyrics, 'lrclib') : null;
  if (synced?.synced) return hit.plainLyrics ? { ...synced, plain: hit.plainLyrics.trim() } : synced;
  return hit.plainLyrics ? lyricsFromText(hit.plainLyrics, 'lrclib') : null;
}

async function loadLyrics(t: AppTrack, base: string, signal: AbortSignal): Promise<Lyrics> {
  const cacheKey = t.key;
  const cached = readCache(cacheKey);
  if (t.origin === 'remote') {
    if (!base) return cached?.lyrics ?? NONE;
    try {
      const l = await apiGet<Lyrics>(base, `/api/tracks/${encodeURIComponent(t.id)}/lyrics`, signal, 15_000);
      writeCache(cacheKey, l);
      return l;
    } catch (e) {
      // Offline (e.g. a downloaded track on the go): fall back to the last answer we saw.
      if (cached) return cached.lyrics;
      throw e;
    }
  }
  // Imported tracks: the file's own tag never changes, so a hit is final; misses retry later.
  if (cached && (hasLyrics(cached.lyrics) || cached.lyrics.instrumental || Date.now() - cached.at < MISS_RETRY_MS)) {
    return cached.lyrics;
  }
  let l = t.localUri ? await fromFile(t.localUri) : null;
  if (!l && settingsStore.getState().lyricsOnline) l = await fromLrclib(t);
  writeCache(cacheKey, l ?? NONE);
  return l ?? NONE;
}

function lyricsQuery(track: AppTrack | null, base: string, online: boolean) {
  return {
    queryKey: ['lyrics', track?.key ?? '', track?.origin === 'remote' ? base : online] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => loadLyrics(track!, base, signal),
    // Server lyrics are asked again after a minute (a cheap 304 when unchanged), so a .lrc added on the server
    // shows up the next time the song's lyrics are opened. Imported tracks keep their own rules (`loadLyrics`).
    staleTime: track?.origin === 'remote' ? 60_000 : 60 * 60_000,
    gcTime: 60 * 60_000,
  };
}

/** Lyrics for a track (server lookup for server tracks; embedded tag, then LRCLIB, for imported ones). */
export function useLyrics(track: AppTrack | null): {
  lyrics: Lyrics | null;
  isLoading: boolean;
  isError: boolean;
  refetch(): void;
} {
  const base = useServerBase();
  const online = useStore(settingsStore, (s) => s.lyricsOnline);
  const q = useQuery({ ...lyricsQuery(track, base, online), enabled: !!track });
  const { refetch } = q;
  return { lyrics: q.data ?? null, isLoading: q.isLoading, isError: q.isError, refetch: () => void refetch() };
}

/** Warm the cache for the song that plays next, so skipping shows its lyrics at once instead of a spinner. */
export function usePrefetchLyrics(track: AppTrack | null | undefined): void {
  const client = useQueryClient();
  const base = useServerBase();
  const online = useStore(settingsStore, (s) => s.lyricsOnline);
  useEffect(() => {
    if (!track) return;
    // Let the current song's own work settle first.
    const t = setTimeout(() => void client.prefetchQuery(lyricsQuery(track, base, online)), 1_500);
    return () => clearTimeout(t);
  }, [client, track, base, online]);
}

/** Highlight slightly early: progress ticks at ~4 Hz, and a line should light up as it starts, not after. */
const LEAD_MS = 250;

/** Index of the line being sung now. Re-renders only when the line changes, not on every progress tick. */
export function useActiveLyric(lines: readonly LyricLine[]): number {
  return useStore(progressStore, (s) => activeLyricIndex(lines, s.positionMs + LEAD_MS));
}
