import { create } from 'zustand';

import { getDb } from './db';

export type DownloadEntry = { file: string; art: string | null; size: number };

type LibIndex = {
  ready: boolean;
  /** Keys of liked tracks — synchronous lookups for `useIsLiked`. */
  liked: ReadonlySet<string>;
  /** Completed downloads by track key (relative paths) — used to resolve `streamUri`/`localUri`. */
  downloads: ReadonlyMap<string, DownloadEntry>;
};

export const libIndex = create<LibIndex>(() => ({ ready: false, liked: new Set(), downloads: new Map() }));

let loading: Promise<void> | null = null;

export function loadLibIndex(): Promise<void> {
  loading ??= (async () => {
    const db = await getDb();
    const [likes, downloads] = await Promise.all([
      db.getAllAsync<{ key: string }>('SELECT key FROM likes'),
      db.getAllAsync<{ key: string; file: string; art: string | null; size_bytes: number }>(
        'SELECT key, file, art, size_bytes FROM downloads',
      ),
    ]);
    libIndex.setState({
      ready: true,
      liked: new Set(likes.map((r) => r.key)),
      downloads: new Map(downloads.map((r) => [r.key, { file: r.file, art: r.art, size: r.size_bytes }])),
    });
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Re-reads likes and downloads after the database changed underneath (library restore). */
export function loadLibIndexAgain(): Promise<void> {
  loading = null;
  return loadLibIndex();
}

export function setLiked(key: string, liked: boolean): void {
  const next = new Set(libIndex.getState().liked);
  if (liked) next.add(key);
  else next.delete(key);
  libIndex.setState({ liked: next });
}

export function setDownload(key: string, entry: DownloadEntry | null): void {
  const next = new Map(libIndex.getState().downloads);
  if (entry) next.set(key, entry);
  else next.delete(key);
  libIndex.setState({ downloads: next });
}

/** Applies several download changes with a single store update (one re-render pass for all subscribers). */
export function setDownloads(updates: Iterable<readonly [string, DownloadEntry | null]>): void {
  const next = new Map(libIndex.getState().downloads);
  for (const [key, entry] of updates) {
    if (entry) next.set(key, entry);
    else next.delete(key);
  }
  libIndex.setState({ downloads: next });
}
