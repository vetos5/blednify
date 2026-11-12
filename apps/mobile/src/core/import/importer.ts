import { createAudioPlayer } from 'expo-audio';
import { getDocumentAsync, type DocumentPickerAsset } from 'expo-document-picker';
import { File, FileMode } from 'expo-file-system';

import { getDb, writeTx } from '../db';
import { removeTrackReferences, type LocalRow } from '../library';
import { DIRS, deleteQuietly, ensureDir, fileAt } from '../paths';
import { removeKeysFromQueue } from '../player/engine';
import { invalidate, libKeys } from '../query-client';
import { extForMime, extOf, hashHex, localArtistId, mimeForExt, randomId } from '../util';
import { readTags, type ByteReader, type Tags } from './tags';

const HEAD_CACHE_BYTES = 1 << 20;
const FINGERPRINT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 4_000;
const UNKNOWN_ARTIST = 'Unknown Artist';
const UNKNOWN_ALBUM = 'Unknown Album';

/** Random-access reader over a file; the first 1 MB is read once and served from memory. */
export function openReader(file: File): ByteReader & { close(): void } {
  const handle = file.open(FileMode.ReadOnly);
  const size = handle.size ?? file.size;
  let head: Uint8Array | null = null;
  return {
    size,
    async read(offset, length) {
      const off = Math.max(0, offset);
      const len = Math.max(0, Math.min(length, size - off));
      if (!len) return new Uint8Array(0);
      if (!head) {
        handle.offset = 0;
        head = await handle.readBytes(Math.min(size, HEAD_CACHE_BYTES));
      }
      if (off + len <= head.length) return head.subarray(off, off + len);
      handle.offset = off;
      return handle.readBytes(len);
    },
    close: () => handle.close(),
  };
}

/** Duration via the platform decoder, for formats whose headers don't carry it. */
function probeDurationMs(uri: string): Promise<number> {
  return new Promise((resolve) => {
    const p = createAudioPlayer(uri, { updateInterval: 200 });
    let done = false;
    const finish = (ms: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.remove();
      p.remove();
      resolve(ms);
    };
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (s.isLoaded && s.duration > 0) finish(Math.round(s.duration * 1000));
    });
    const timer = setTimeout(() => finish(p.isLoaded && p.duration > 0 ? Math.round(p.duration * 1000) : 0), PROBE_TIMEOUT_MS);
  });
}

/** Remove the picker's cache copy (we were given our own copy via `copyToCacheDirectory`). */
function discard(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache is purged by the OS eventually.
  }
}

/** `Artist - Title.ext` → { artist, title }; otherwise the bare name is the title. */
function parseFileName(name: string): { artist?: string; title: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].replace(/^\d{1,3}[.\s-]+/, '').trim() || m[2].trim() };
  return { title: base.replace(/^\d{1,3}[.\s-]+(?=\S)/, '') || base || 'Untitled' };
}

async function importOne(asset: DocumentPickerAsset): Promise<boolean> {
  const src = new File(asset.uri);
  if (!src.exists) return false;
  const ext = extOf(asset.name) || extOf(src.uri) || extForMime(asset.mimeType);
  const mimeType = asset.mimeType && asset.mimeType.startsWith('audio/') ? asset.mimeType : mimeForExt(ext);

  let tags: Tags = {};
  let size = 0;
  let fingerprint: string;
  const reader = openReader(src);
  try {
    size = reader.size;
    const head = await reader.read(0, FINGERPRINT_BYTES);
    fingerprint = `${hashHex(head)}:${size}`;
    try {
      tags = await readTags(reader);
    } catch (e) {
      console.warn('[import] tag parse failed', asset.name, e);
    }
  } finally {
    reader.close();
  }

  const db = await getDb();
  const dup = await db.getFirstAsync<{ id: string }>('SELECT id FROM local_tracks WHERE fingerprint = ?', fingerprint);
  if (dup) {
    discard(src);
    return false;
  }

  const id = randomId();
  ensureDir(DIRS.local);
  const fileRel = `${DIRS.local}/${id}.${ext}`;
  const dest = fileAt(fileRel);
  await src.move(dest, { overwrite: true });

  let artRel: string | null = null;
  if (tags.picture) {
    ensureDir(DIRS.art);
    artRel = `${DIRS.art}/${id}.${tags.picture.mime === 'image/png' ? 'png' : 'jpg'}`;
    try {
      const art = fileAt(artRel);
      art.create({ intermediates: true, overwrite: true });
      await art.write(tags.picture.data);
    } catch (e) {
      console.warn('[import] could not save artwork', e);
      artRel = null;
    }
  }

  const durationMs = tags.durationMs && tags.durationMs > 0 ? tags.durationMs : await probeDurationMs(dest.uri);
  const fromName = parseFileName(asset.name);
  const artist = tags.artist ?? tags.albumArtist ?? fromName.artist ?? UNKNOWN_ARTIST;
  const album = tags.album ?? UNKNOWN_ALBUM;
  const albumArtist = tags.albumArtist ?? artist;
  const row: LocalRow = {
    id,
    title: tags.title ?? fromName.title,
    artist,
    album,
    album_id: `l:${hashHex(`${albumArtist.toLowerCase()}\u0000${album.toLowerCase()}`)}`,
    artist_id: localArtistId(artist),
    duration_ms: durationMs,
    track_number: tags.trackNumber ?? null,
    disc_number: tags.discNumber ?? null,
    year: tags.year ?? null,
    genre: tags.genre ?? null,
    mime_type: mimeType,
    size_bytes: size,
    file: fileRel,
    art: artRel,
    added_at: new Date().toISOString(),
  };
  try {
    await writeTx((tx) =>
      tx.runAsync(
        `INSERT INTO local_tracks (id, title, artist, album, album_id, artist_id, duration_ms, track_number,
           disc_number, year, genre, mime_type, size_bytes, file, art, fingerprint, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.title,
        row.artist,
        row.album,
        row.album_id,
        row.artist_id,
        row.duration_ms,
        row.track_number,
        row.disc_number,
        row.year,
        row.genre,
        row.mime_type,
        row.size_bytes,
        row.file,
        row.art,
        fingerprint,
        row.added_at,
      ),
    );
  } catch (e) {
    deleteQuietly(fileRel);
    deleteQuietly(artRel);
    throw e;
  }
  return true;
}

/** Pick audio files and copy them into app storage. Nothing is uploaded unless the user asks (admin mode). */
export async function importFromDevice(): Promise<{ imported: number; skipped: number }> {
  const res = await getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return { imported: 0, skipped: 0 };
  let imported = 0;
  let skipped = 0;
  for (const asset of res.assets) {
    try {
      if (await importOne(asset)) imported++;
      else skipped++;
    } catch (e) {
      console.warn('[import] failed', asset.name, e);
      discard(new File(asset.uri));
      skipped++;
    }
    // Let lists update progressively on large imports.
    if ((imported + skipped) % 10 === 0) invalidate(libKeys.all);
  }
  invalidate(libKeys.all);
  return { imported, skipped };
}

export async function deleteLocalTrack(key: string): Promise<void> {
  if (!key.startsWith('l:')) return;
  const id = key.slice(2);
  const db = await getDb();
  const row = await db.getFirstAsync<{ file: string; art: string | null }>(
    'SELECT file, art FROM local_tracks WHERE id = ?',
    id,
  );
  await writeTx(async (tx) => {
    await tx.runAsync('DELETE FROM local_tracks WHERE id = ?', id);
    await removeTrackReferences(tx, [key]);
  });
  removeKeysFromQueue(new Set([key]));
  if (row) {
    deleteQuietly(row.file);
    deleteQuietly(row.art);
  }
  invalidate(libKeys.all);
}
