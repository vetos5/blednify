/** The library backup document and its merge (pure: no device or network access, unit-tested). */

export type SyncedPlaylist =
  | { name: string; createdAt: number; updatedAt: number; cover: string | null; importId: string | null; tracks: string[] }
  | { deleted: true; updatedAt: number };
export type SyncedLike = { at: number; track: string } | { deleted: true; at: number };

export type LibraryDoc = { v: 1; playlists: Record<string, SyncedPlaylist>; likes: Record<string, SyncedLike> };

const stampOf = (p: SyncedPlaylist) => p.updatedAt;
const likeStamp = (l: SyncedLike) => l.at;

/** Newer entry wins; on a tie the device keeps its own. Entries only one side has are kept. */
export function mergeDocs(local: LibraryDoc, remote: LibraryDoc | null): LibraryDoc {
  if (!remote) return local;
  const pick = <T>(a: Record<string, T>, b: Record<string, T>, stamp: (x: T) => number): Record<string, T> => {
    const out: Record<string, T> = { ...b };
    for (const [id, mine] of Object.entries(a)) {
      const theirs = b[id];
      if (!theirs || stamp(mine) >= stamp(theirs)) out[id] = mine;
    }
    return out;
  };
  return { v: 1, playlists: pick(local.playlists, remote.playlists, stampOf), likes: pick(local.likes, remote.likes, likeStamp) };
}

export function sameDoc(a: LibraryDoc, b: LibraryDoc | null): boolean {
  return !!b && JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

const sortKeys = (d: LibraryDoc) => ({
  playlists: Object.keys(d.playlists).sort().map((k) => [k, d.playlists[k]]),
  likes: Object.keys(d.likes).sort().map((k) => [k, d.likes[k]]),
});

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A v1 document (extra top-level fields are tolerated, so additive changes don't need a new version). */
export function isDoc(x: unknown): x is LibraryDoc {
  return isRecord(x) && x.v === 1 && isRecord(x.playlists) && isRecord(x.likes);
}
