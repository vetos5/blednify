/**
 * Autoplay (like Spotify's): when what the user started runs out (a single song from Search or its page, the last
 * songs of an album), the queue carries on with related songs instead of stopping. Pure, so the rules are unit-tested
 * (test/autoplay.test.ts); engine.ts fetches the candidates and owns the queue.
 *
 * The queue holds autoplay songs as its tail: `entries[autoFrom..]`. Everything before `autoFrom` is what the user
 * chose (the context, "Play next", "Add to queue"), so a song the user queues goes in before the autoplay ones and
 * plays first. An autoplay song that starts playing becomes an ordinary part of the queue (`promoteAuto`): the tail
 * only ever holds songs that haven't played yet. Repeat all / repeat one keep their meaning, so there is no autoplay
 * while either is on (`autoplayWanted`), and turning one on drops the tail.
 */

/** Fill the tail when the songs the user chose that are still to come are this few or fewer. */
export const AUTOPLAY_WHEN_LEFT = 1;
/** Keep this many autoplay songs ahead (the Queue shows them; native pre-buffers the first). */
export const AUTOPLAY_BATCH = 10;
/** Top the tail up again once fewer than this many are left ahead. */
export const AUTOPLAY_LOW = 3;

export type AutoplayState = {
  enabled: boolean;
  repeatOff: boolean;
  index: number;
  length: number;
  autoFrom: number;
};

/** How many autoplay songs to fetch now (0: none needed). */
export function autoplayWanted({ enabled, repeatOff, index, length, autoFrom }: AutoplayState): number {
  if (!enabled || !repeatOff || index < 0 || length === 0) return 0;
  const from = Math.min(Math.max(autoFrom, index + 1), length);
  const chosenLeft = from - index - 1;
  const autoLeft = length - from;
  if (chosenLeft > AUTOPLAY_WHEN_LEFT) return 0;
  if (autoLeft >= AUTOPLAY_LOW) return 0;
  return AUTOPLAY_BATCH - autoLeft;
}

/** Where the autoplay tail starts once `index` plays: a song that started playing is no longer "autoplay". */
export function promoteAuto(index: number, autoFrom: number, length: number): number {
  return Math.min(Math.max(autoFrom, index + 1, 0), length);
}

/** The saved count of autoplay songs at the end of a restored queue, as `autoFrom` (missing or bad: none). */
export function restoredAutoFrom(length: number, savedAutoCount: unknown, index: number): number {
  const n = typeof savedAutoCount === 'number' && Number.isInteger(savedAutoCount) && savedAutoCount > 0 ? savedAutoCount : 0;
  return promoteAuto(index, length - Math.min(n, length), length);
}

/** Shuffle the songs the user chose, keeping `cur` first and the autoplay tail (`items[autoFrom..]`) as it is. */
export function shuffleChosen<T>(original: readonly T[], cur: T, autoCount: number, shuffle: (xs: readonly T[]) => T[]): T[] {
  const chosen = original.slice(0, original.length - autoCount);
  const tail = original.slice(original.length - autoCount);
  return [cur, ...shuffle(chosen.filter((e) => e !== cur)), ...tail];
}

export type Candidate = { key: string; artist: string; artistId: string; albumId: string; album: string };

/**
 * The autoplay songs that follow `seed`: other songs by the same artist, then songs from the same album, then the rest
 * of the library, each group shuffled; no song twice, nothing in `exclude` (the queue, the seed itself). `artist` and
 * `album` are what the server lists for the seed's artist and album; songs in `library` match too when their artist
 * (by `keyOf`, so spellings agree) or album is the seed's.
 */
export function planAutoplay<T extends Candidate>({
  seed,
  artist,
  album,
  library,
  exclude,
  limit,
  shuffle,
  keyOf,
}: {
  seed: Candidate;
  artist: readonly T[];
  album: readonly T[];
  library: readonly T[];
  exclude: ReadonlySet<string>;
  limit: number;
  shuffle: (xs: readonly T[]) => T[];
  keyOf: (artistName: string) => string;
}): T[] {
  if (limit <= 0) return [];
  const seen = new Set(exclude);
  seen.add(seed.key);
  const seedArtist = keyOf(seed.artist);
  const sameArtist = (t: T) => (!!seed.artistId && t.artistId === seed.artistId) || (!!seedArtist && keyOf(t.artist) === seedArtist);
  const sameAlbum = (t: T) =>
    (!!seed.albumId && t.albumId === seed.albumId) || (!!seed.album && t.album === seed.album && sameArtist(t));
  const groups: T[][] = [[], [], []];
  const placed = new Set<string>();
  const put = (g: number, t: T) => {
    if (seen.has(t.key) || placed.has(t.key)) return;
    placed.add(t.key);
    groups[g].push(t);
  };
  for (const t of artist) put(0, t);
  for (const t of library) if (sameArtist(t)) put(0, t);
  for (const t of album) put(1, t);
  for (const t of library) if (sameAlbum(t)) put(1, t);
  for (const t of library) put(2, t);
  const out: T[] = [];
  for (const g of groups) {
    for (const t of shuffle(g)) {
      if (out.length >= limit) return out;
      out.push(t);
    }
  }
  return out;
}
