import { router } from 'expo-router';

import type { Origin } from '@/core';

import { setPanel } from './desktop/store';
import { isWideNow } from './layout';

export const nav = {
  album: (id: string, origin: Origin) => router.push({ pathname: '/album/[id]', params: { id, origin } }),
  artist: (id: string, origin: Origin) => router.push({ pathname: '/artist/[id]', params: { id, origin } }),
  playlist: (id: string) => router.push({ pathname: '/playlist/[id]', params: { id } }),
  player: () => router.push('/player'),
  /** Wide layout: opens the side panel next to the page instead of a full-screen route. */
  queue: () => (isWideNow() ? setPanel('queue') : router.push('/queue')),
  lyrics: () => (isWideNow() ? setPanel('lyrics') : router.push('/lyrics')),
  upload: () => router.push('/upload'),
  importPlaylist: () => router.push('/import'),
  duplicates: () => router.push('/duplicates'),
  settings: () => router.push('/settings'),
  appearance: () => router.push('/appearance'),
  appIcon: () => router.push('/app-icon'),
  downloads: () => router.push('/downloads'),
  /** Switch tab; from a root-stack screen, pops back to the existing tabs (see `library`). */
  tab: (name: 'index' | 'search') => toTabs(name === 'index' ? '/' : '/search'),
  /** From a root-stack screen, pop back to the existing tabs instead of stacking a second tab navigator. */
  library: (filter?: LibraryFilter) => toTabs({ pathname: '/library', params: filter ? { filter } : {} }),
};

/** Name of the focused root-stack screen, kept by the root layout's `screenListeners`. */
let rootTop = '(tabs)';
export function trackRootFocus(name: string) {
  rootTop = name;
}

function toTabs(href: Parameters<typeof router.navigate>[0]) {
  // dismissTo only pops: with the tabs already on top (a page opened by URL, then a tab, so the tabs sit
  // above it) it is a no-op and the tab never changes. Switch in place then.
  if (rootTop !== '(tabs)' && router.canDismiss()) router.dismissTo(href);
  else router.navigate(href);
}

export type LibraryFilter = 'playlists' | 'recents' | 'albums' | 'liked' | 'downloaded' | 'device';

export function parseOrigin(v: string | string[] | undefined): Origin {
  return v === 'local' ? 'local' : 'remote';
}
