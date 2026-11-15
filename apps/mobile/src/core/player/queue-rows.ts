/**
 * Compact on-disk form of the play queue.
 *
 * A queued track is stored as a positional row instead of the full `AppTrack` object: no repeated field names,
 * and no URIs that can be rebuilt (a server track's stream and artwork URLs come from its id and the current
 * server, its downloaded copy from the downloads index). Everything the player shows is kept, including the file
 * info card's tags, so a restored queue looks the same as before the restart.
 */
import { trackArtworkUrl, trackStreamUrl } from '../api';
import { getServerBase } from '../settings';
import { fromStorable, toStorable } from '../tracks';
import type { AppTrack } from '../types';

/** Rarely set fields; omitted when empty. `s`/`u` are an on-device track's (relative) stream and file URIs. */
type Extra = {
  e?: 1;
  b?: number | null;
  c?: string | null;
  sr?: number | null;
  bd?: number | null;
  l?: 1;
  s?: string;
  u?: string | null;
};

export type QueueRow = [
  key: string,
  title: string,
  artist: string,
  album: string,
  albumId: string,
  artistId: string,
  durationMs: number,
  trackNumber: number | null,
  discNumber: number | null,
  year: number | null,
  genre: string | null,
  mimeType: string,
  sizeBytes: number,
  addedAt: string,
  /** Server track: 1 when it has artwork. On-device track: its (relative) artwork URI or null. */
  art: 0 | 1 | string | null,
  extra: Extra | 0,
];

export function toRow(t: AppTrack): QueueRow {
  const local = t.origin === 'local';
  const s = local ? toStorable(t) : t;
  const x: Extra = {};
  if (t.edited) x.e = 1;
  if (t.bitrate != null) x.b = t.bitrate;
  if (t.codec != null) x.c = t.codec;
  if (t.sampleRate != null) x.sr = t.sampleRate;
  if (t.bitDepth != null) x.bd = t.bitDepth;
  if (t.lossless) x.l = 1;
  if (local) {
    x.s = s.streamUri;
    x.u = s.localUri;
  }
  return [
    t.key,
    t.title,
    t.artist,
    t.album,
    t.albumId,
    t.artistId,
    t.durationMs,
    t.trackNumber,
    t.discNumber,
    t.year,
    t.genre,
    t.mimeType,
    t.sizeBytes,
    t.addedAt,
    local ? s.artworkUri : t.artworkUri ? 1 : 0,
    Object.keys(x).length ? x : 0,
  ];
}

/** Null for a row that isn't one (corrupt or from an unknown version). URIs still need `resolveTrack`. */
export function fromRow(r: unknown, base = getServerBase()): AppTrack | null {
  if (!Array.isArray(r) || typeof r[0] !== 'string' || r[0].length < 3) return null;
  const [key, title, artist, album, albumId, artistId, durationMs, trackNumber, discNumber, year, genre, mimeType, sizeBytes, addedAt, art, extra] =
    r as QueueRow;
  const local = key.startsWith('l:');
  if (!local && !key.startsWith('r:')) return null;
  const id = key.slice(2);
  const x: Extra = extra && typeof extra === 'object' ? extra : {};
  const t: AppTrack = {
    key,
    id,
    origin: local ? 'local' : 'remote',
    title: String(title ?? ''),
    artist: String(artist ?? ''),
    album: String(album ?? ''),
    albumId: String(albumId ?? ''),
    artistId: String(artistId ?? ''),
    durationMs: Number(durationMs) || 0,
    trackNumber: trackNumber ?? null,
    discNumber: discNumber ?? null,
    year: year ?? null,
    genre: genre ?? null,
    mimeType: String(mimeType ?? ''),
    sizeBytes: Number(sizeBytes) || 0,
    addedAt: String(addedAt ?? ''),
    edited: x.e === 1,
    bitrate: x.b ?? null,
    codec: x.c ?? null,
    sampleRate: x.sr ?? null,
    bitDepth: x.bd ?? null,
    lossless: x.l === 1,
    artworkUri: null,
    streamUri: '',
    localUri: null,
  };
  if (local) {
    t.artworkUri = typeof art === 'string' ? art : null;
    t.streamUri = x.s ?? '';
    t.localUri = x.u ?? null;
    return fromStorable(t);
  }
  // `resolveTrack` only keeps a server track's artwork when `artworkUri` is set, so it doubles as the flag.
  t.artworkUri = art && base ? trackArtworkUrl(base, id) : null;
  t.streamUri = base ? trackStreamUrl(base, id) : '';
  return t;
}
