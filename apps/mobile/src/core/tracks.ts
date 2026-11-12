import { useStore } from 'zustand';
import { useMemo } from 'react';

import { trackArtworkUrl, trackStreamUrl, type ApiAlbum, type ApiArtist, type ApiTrack } from './api';
import { libIndex, type DownloadEntry } from './lib-index';
import { absUri, relUri } from './paths';
import { getServerBase, useServerBase } from './settings';
import type { AlbumView, AppTrack, ArtistView } from './types';

/** Everything needed to turn a stored/remote track into playable URIs. */
export type ResolveCtx = { base: string; downloads: ReadonlyMap<string, DownloadEntry> };

export const currentCtx = (): ResolveCtx => ({ base: getServerBase(), downloads: libIndex.getState().downloads });

export function useResolveCtx(): ResolveCtx {
  const base = useServerBase();
  const downloads = useStore(libIndex, (s) => s.downloads);
  return useMemo(() => ({ base, downloads }), [base, downloads]);
}

/**
 * Recompute URIs of a remote track for the current server URL and download state.
 * Local tracks are returned unchanged. Returns the same object when nothing changed.
 */
export function resolveTrack(t: AppTrack, ctx: ResolveCtx = currentCtx()): AppTrack {
  if (t.origin === 'local') return t;
  const dl = ctx.downloads.get(t.key);
  const localUri = dl ? absUri(dl.file) : null;
  const artworkUri = dl?.art ? absUri(dl.art) : t.artworkUri && ctx.base ? trackArtworkUrl(ctx.base, t.id) : null;
  const streamUri = localUri ?? (ctx.base ? trackStreamUrl(ctx.base, t.id) : '');
  if (t.localUri === localUri && t.artworkUri === artworkUri && t.streamUri === streamUri) return t;
  return { ...t, localUri, artworkUri, streamUri };
}

export function useResolvedTracks(tracks: readonly AppTrack[] | undefined): AppTrack[] {
  const ctx = useResolveCtx();
  return useMemo(() => (tracks ? tracks.map((t) => resolveTrack(t, ctx)) : EMPTY_TRACKS), [tracks, ctx]);
}

export const EMPTY_TRACKS: AppTrack[] = [];

export function fromApiTrack(t: ApiTrack, base: string): AppTrack {
  return {
    key: `r:${t.id}`,
    id: t.id,
    origin: 'remote',
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumId: t.albumId,
    artistId: t.artistId,
    durationMs: t.durationMs,
    trackNumber: t.trackNumber,
    discNumber: t.discNumber,
    year: t.year,
    genre: t.genre,
    mimeType: t.mimeType,
    sizeBytes: t.sizeBytes,
    artworkUri: t.hasArtwork ? trackArtworkUrl(base, t.id) : null,
    streamUri: trackStreamUrl(base, t.id),
    localUri: null,
    addedAt: t.addedAt,
    edited: t.edited ?? false,
  };
}

export function fromApiAlbum(a: ApiAlbum, base: string): AlbumView {
  return {
    id: a.id,
    origin: 'remote',
    title: a.title,
    artist: a.artist,
    artistId: a.artistId,
    year: a.year,
    trackCount: a.trackCount,
    durationMs: a.durationMs,
    artworkUri: a.artworkTrackId ? trackArtworkUrl(base, a.artworkTrackId) : null,
  };
}

export function fromApiArtist(a: ApiArtist, base: string): ArtistView {
  return {
    id: a.id,
    origin: 'remote',
    name: a.name,
    aliases: a.aliases ?? [],
    merged: a.merged ?? false,
    albumCount: a.albumCount,
    trackCount: a.trackCount,
    artworkUri: a.artworkTrackId ? trackArtworkUrl(base, a.artworkTrackId) : null,
  };
}

/** Snapshot for persistence: URIs inside the document dir become relative (container path can move). */
export function toStorable(t: AppTrack): AppTrack {
  return {
    ...t,
    artworkUri: t.artworkUri && relUri(t.artworkUri),
    streamUri: relUri(t.streamUri),
    localUri: t.localUri && relUri(t.localUri),
  };
}

const absolutize = (u: string) => (u && !u.includes('://') ? absUri(u) : u);

export function fromStorable(t: AppTrack): AppTrack {
  if (t.origin !== 'local') return t;
  return {
    ...t,
    artworkUri: t.artworkUri && absolutize(t.artworkUri),
    streamUri: absolutize(t.streamUri),
    localUri: t.localUri && absolutize(t.localUri),
  };
}

export const serializeTrack = (t: AppTrack): string => JSON.stringify(toStorable(t));

export function parseTrack(json: string): AppTrack | null {
  try {
    const t = JSON.parse(json) as AppTrack;
    return t && typeof t.key === 'string' ? fromStorable(t) : null;
  } catch {
    return null;
  }
}

export function dedupeByKey<T extends { key: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out;
}

const VARIOUS = 'Various Artists';

/** Group tracks into albums, preserving first-seen order. */
export function albumsFromTracks(tracks: readonly AppTrack[]): AlbumView[] {
  const map = new Map<string, AlbumView>();
  for (const t of tracks) {
    const id = `${t.origin}:${t.albumId}`;
    const a = map.get(id);
    if (!a) {
      map.set(id, {
        id: t.albumId,
        origin: t.origin,
        title: t.album,
        artist: t.artist,
        artistId: t.artistId,
        year: t.year,
        trackCount: 1,
        durationMs: t.durationMs,
        artworkUri: t.artworkUri,
      });
      continue;
    }
    a.trackCount++;
    a.durationMs += t.durationMs;
    a.artworkUri ??= t.artworkUri;
    a.year ??= t.year;
    if (a.artistId !== t.artistId && a.artist !== VARIOUS) a.artist = VARIOUS;
  }
  return [...map.values()];
}

/** Group tracks into artists, preserving first-seen order. */
export function artistsFromTracks(tracks: readonly AppTrack[]): ArtistView[] {
  const map = new Map<string, ArtistView & { albums: Set<string> }>();
  for (const t of tracks) {
    const id = `${t.origin}:${t.artistId}`;
    const a = map.get(id);
    if (!a) {
      map.set(id, {
        id: t.artistId,
        origin: t.origin,
        name: t.artist,
        albumCount: 1,
        trackCount: 1,
        artworkUri: t.artworkUri,
        albums: new Set([t.albumId]),
      });
      continue;
    }
    a.trackCount++;
    a.albums.add(t.albumId);
    a.albumCount = a.albums.size;
    a.artworkUri ??= t.artworkUri;
  }
  return [...map.values()].map(({ albums: _albums, ...rest }) => rest);
}

/** Album order: disc, track number, then title. */
export function compareAlbumOrder(a: AppTrack, b: AppTrack): number {
  return (
    (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
    (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) ||
    a.title.localeCompare(b.title)
  );
}
