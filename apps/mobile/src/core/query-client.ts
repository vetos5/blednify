import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { shouldRetryQuery } from './query-retry';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: (failureCount, error) => shouldRetryQuery(failureCount, error, serverKnownDown()),
      // The server is often on a LAN that the OS considers "offline"; let requests fail fast instead of pausing.
      networkMode: 'always',
    },
  },
});

/** The current server's health check failed last time it ran (`useServerStatus` keys it ['health', base, token]). */
function serverKnownDown(): boolean {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['health'] })
    .some((q) => q.state.status === 'error' && q.state.dataUpdatedAt <= q.state.errorUpdatedAt && q.isActive());
}

// Revalidate stale queries when the app returns to the foreground.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});

/** Local (SQLite) query keys — invalidated on mutation so hooks re-query. */
export const libKeys = {
  all: ['lib'] as const,
  local: ['lib', 'local'] as const,
  likes: ['lib', 'likes'] as const,
  recents: ['lib', 'recents'] as const,
  playlists: ['lib', 'playlists'] as const,
  playlist: (id: string) => ['lib', 'playlist', id] as const,
  album: (origin: string, id: string) => ['lib', 'album', origin, id] as const,
  artist: (origin: string, id: string) => ['lib', 'artist', origin, id] as const,
  search: (q: string) => ['lib', 'search', q] as const,
};

const invalidateListeners = new Set<(keys: readonly (readonly unknown[])[]) => void>();

/** Hear about library mutations even when no screen holds the query (e.g. the Android Auto tree). */
export function onInvalidate(fn: (keys: readonly (readonly unknown[])[]) => void): () => void {
  invalidateListeners.add(fn);
  return () => invalidateListeners.delete(fn);
}

export function invalidate(...keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  for (const fn of invalidateListeners) fn(keys);
}
