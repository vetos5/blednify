/** Admin views of server artists: merge suggestions and an artist picker search. */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetchMergeSuggestions } from './admin';
import { apiGet, queryString, type ApiArtist, type ApiPage } from './api';
import { useDebounced } from './catalog';
import { useServerBase, useSettings } from './settings';
import { fromApiArtist } from './tracks';
import type { ArtistView } from './types';

export type ArtistPair = { a: ArtistView; b: ArtistView; score: number };

/** Artist pairs that look like the same artist (admin mode only). */
export function useMergeSuggestions(): { pairs: ArtistPair[]; isLoading: boolean; error: string | null; refetch: () => void } {
  const base = useServerBase();
  const { adminMode, adminToken } = useSettings();
  const q = useQuery({
    queryKey: ['merge-suggestions', base],
    queryFn: fetchMergeSuggestions,
    enabled: !!base && adminMode && !!adminToken,
    staleTime: 30_000,
  });
  const pairs = useMemo(
    () => (q.data ?? []).map((p) => ({ a: fromApiArtist(p.a, base), b: fromApiArtist(p.b, base), score: p.score })),
    [q.data, base],
  );
  return { pairs, isLoading: q.isLoading, error: q.error ? (q.error as Error).message : null, refetch: () => void q.refetch() };
}

/** Server artists matching `query` (all artists by name when empty), for pickers. */
export function useArtistSearch(query: string, limit = 30): { artists: ArtistView[]; isLoading: boolean } {
  const base = useServerBase();
  const q = useDebounced(query.trim(), 200);
  const r = useQuery({
    queryKey: ['artist-search', base, q, limit],
    queryFn: ({ signal }) => apiGet<ApiPage<ApiArtist>>(base, `/api/artists${queryString({ q, limit })}`, signal),
    enabled: !!base,
    staleTime: 60_000,
  });
  const artists = useMemo(() => (r.data?.items ?? []).map((a) => fromApiArtist(a, base)), [r.data, base]);
  return { artists, isLoading: r.isLoading };
}
