/**
 * Bookkeeping of songs the server reports deleted (pure, unit-tested; used by prune.ts). A song is dropped from
 * likes and playlists only once it has stayed deleted for GONE_GRACE_MS: a drive or folder that was unmounted for a
 * while (the server rescanned without it) then costs nothing, since its songs come back under the same ids.
 */
export const GONE_GRACE_MS = 24 * 60 * 60_000;

/**
 * `seen`: key -> when it was first reported gone. `gone`: keys reported now. `complete`: every referenced key was
 * checked (else keys not reported this time keep their date). Downloaded songs are never dropped: they play offline.
 * Returns the bookkeeping to store and the keys to drop now.
 */
export function ripenGone(
  seen: Readonly<Record<string, number>>,
  gone: readonly string[],
  isDownloaded: (key: string) => boolean,
  now: number,
  complete: boolean,
): { next: Record<string, number>; ripe: string[] } {
  const next: Record<string, number> = complete ? {} : { ...seen };
  const ripe: string[] = [];
  for (const key of gone) {
    if (isDownloaded(key)) continue;
    const since = seen[key] ?? now;
    next[key] = since;
    if (now - since >= GONE_GRACE_MS) ripe.push(key);
  }
  for (const key of ripe) delete next[key];
  return { next, ripe };
}
