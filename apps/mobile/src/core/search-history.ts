/**
 * Recent-search history.
 *
 * Storage: MMKV (`kv`) under a single JSON key — fast synchronous reads, no migration needed,
 * total payload is small (<20 items × ~200 bytes each = well under 4 KB). Zustand makes the
 * store subscribable so the UI re-renders automatically on mutations.
 *
 * Stored entry kinds (most-recent-first):
 *   - 'query'  : a submitted text string the user typed
 *   - 'track'  : a track the user tapped from results
 *   - 'album'  : an album the user tapped from results
 *   - 'artist' : an artist the user tapped from results
 */
import { useMemo } from 'react';
import { create, useStore } from 'zustand';

import { absUri, relUri } from './paths';
import { kv } from './settings';
import { fromStorable, resolveTrack, toStorable, useResolveCtx, type ResolveCtx } from './tracks';
import type { AlbumView, AppTrack, ArtistView } from './types';

export type SearchHistoryTrack = {
  kind: 'track';
  id: string; // track.key — dedupe key
  track: AppTrack;
};

export type SearchHistoryAlbum = {
  kind: 'album';
  id: string; // `album:${origin}:${id}`
  album: AlbumView;
};

export type SearchHistoryArtist = {
  kind: 'artist';
  id: string; // `artist:${origin}:${id}`
  artist: ArtistView;
};

export type SearchHistoryQuery = {
  kind: 'query';
  id: string; // `query:${trimmedQuery.toLowerCase()}`
  query: string;
};

export type SearchHistoryEntry =
  | SearchHistoryTrack
  | SearchHistoryAlbum
  | SearchHistoryArtist
  | SearchHistoryQuery;

const KV_KEY = 'searchHistory.v1';

/** Local artwork lives in the app container, whose absolute path can move between installs (iOS). */
const artToStore = (origin: string, uri: string | null) => (origin === 'local' && uri ? relUri(uri) : uri);
const artFromStore = (origin: string, uri: string | null) =>
  origin === 'local' && uri && !uri.includes('://') ? absUri(uri) : uri;

/** Remote artwork URLs embed the server base; re-point them at the current server. */
function rebase(uri: string | null, base: string): string | null {
  if (!uri || !base) return uri;
  const i = uri.indexOf('/api/');
  return i > 0 ? base + uri.slice(i) : uri;
}

function resolveEntry(e: SearchHistoryEntry, ctx: ResolveCtx): SearchHistoryEntry {
  switch (e.kind) {
    case 'track':
      return { ...e, track: resolveTrack(e.track, ctx) };
    case 'album':
      return e.album.origin === 'remote' ? { ...e, album: { ...e.album, artworkUri: rebase(e.album.artworkUri, ctx.base) } } : e;
    case 'artist':
      return e.artist.origin === 'remote' ? { ...e, artist: { ...e.artist, artworkUri: rebase(e.artist.artworkUri, ctx.base) } } : e;
    default:
      return e;
  }
}
const MAX_ENTRIES = 20;

function load(): SearchHistoryEntry[] {
  try {
    const raw = kv.getString(KV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((e: SearchHistoryEntry): SearchHistoryEntry[] => {
      if (!e || typeof e !== 'object' || !('kind' in e)) return [];
      if (e.kind === 'track' && e.track) {
        return [{ ...e, track: fromStorable(e.track) }];
      }
      if (e.kind === 'album' && e.album) {
        return [{ ...e, album: { ...e.album, artworkUri: artFromStore(e.album.origin, e.album.artworkUri) } }];
      }
      if (e.kind === 'artist' && e.artist) {
        return [{ ...e, artist: { ...e.artist, artworkUri: artFromStore(e.artist.origin, e.artist.artworkUri) } }];
      }
      return e.kind === 'query' ? [e] : [];
    });
  } catch {
    return [];
  }
}

function save(entries: SearchHistoryEntry[]) {
  try {
    const storable = entries.map((e) => {
      if (e.kind === 'track') return { ...e, track: toStorable(e.track) };
      if (e.kind === 'album') return { ...e, album: { ...e.album, artworkUri: artToStore(e.album.origin, e.album.artworkUri) } };
      if (e.kind === 'artist') return { ...e, artist: { ...e.artist, artworkUri: artToStore(e.artist.origin, e.artist.artworkUri) } };
      return e;
    });
    kv.set(KV_KEY, JSON.stringify(storable));
  } catch {
    // best-effort
  }
}

type SearchHistoryState = {
  entries: SearchHistoryEntry[];
};

export const searchHistoryStore = create<SearchHistoryState>(() => ({
  entries: load(),
}));

function push(entry: SearchHistoryEntry) {
  const current = searchHistoryStore.getState().entries;
  // Dedupe by id — remove any existing entry with the same id, then prepend.
  const filtered = current.filter((e) => e.id !== entry.id);
  const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
  save(next);
  searchHistoryStore.setState({ entries: next });
}

/** Record a submitted search query string. */
export function pushSearchQuery(query: string): void {
  const q = query.trim();
  if (!q) return;
  push({ kind: 'query', id: `query:${q.toLowerCase()}`, query: q });
}

/** Record a tapped track result. */
export function pushSearchTrack(track: AppTrack): void {
  push({ kind: 'track', id: track.key, track });
}

/** Record a tapped album result. */
export function pushSearchAlbum(album: AlbumView): void {
  push({ kind: 'album', id: `album:${album.origin}:${album.id}`, album });
}

/** Record a tapped artist result. */
export function pushSearchArtist(artist: ArtistView): void {
  push({ kind: 'artist', id: `artist:${artist.origin}:${artist.id}`, artist });
}

/** Remove a single history entry by its id. */
export function removeSearchEntry(id: string): void {
  const current = searchHistoryStore.getState().entries;
  const next = current.filter((e) => e.id !== id);
  save(next);
  searchHistoryStore.setState({ entries: next });
}

/** Drop tracks that were deleted from the library or server. */
export function removeSearchTracks(keys: readonly string[]): void {
  const drop = new Set(keys);
  const current = searchHistoryStore.getState().entries;
  const next = current.filter((e) => !(e.kind === 'track' && drop.has(e.track.key)));
  if (next.length === current.length) return;
  save(next);
  searchHistoryStore.setState({ entries: next });
}

/** Follows songs the server moved (old key -> new key); an entry whose new key is already listed is dropped. */
export function renameSearchTracks(moves: ReadonlyMap<string, string>): void {
  const current = searchHistoryStore.getState().entries;
  if (!current.some((e) => e.kind === 'track' && moves.has(e.track.key))) return;
  const seen = new Set(current.map((e) => e.id));
  const next: SearchHistoryEntry[] = [];
  for (const e of current) {
    const to = e.kind === 'track' ? moves.get(e.track.key) : undefined;
    if (e.kind !== 'track' || !to) next.push(e);
    else if (!seen.has(to)) {
      seen.add(to);
      next.push({ kind: 'track', id: to, track: { ...e.track, key: to, id: to.slice(2) } });
    }
  }
  save(next);
  searchHistoryStore.setState({ entries: next });
}

/** Remove all history entries. */
export function clearSearchHistory(): void {
  kv.remove(KV_KEY);
  searchHistoryStore.setState({ entries: [] });
}

/** Subscribable hook — re-renders whenever history changes; URIs follow the current server and downloads. */
export function useSearchHistory(): SearchHistoryEntry[] {
  // Through useStore, not `searchHistoryStore(...)`: React Compiler only treats `use*` calls as hooks and would
  // otherwise memoize this one away, shifting hook order (crashed Search on typing).
  const entries = useStore(searchHistoryStore, (s) => s.entries);
  const ctx = useResolveCtx();
  return useMemo(() => entries.map((e) => resolveEntry(e, ctx)), [entries, ctx]);
}
