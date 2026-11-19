import { getRandomBytes } from 'expo-crypto';
import { AppState } from 'react-native';
import { create, useStore } from 'zustand';

import { ApiError } from './api';
import type { SQLiteDatabase } from 'expo-sqlite';

import { writeTx } from './db';
import { loadLibIndexAgain } from './lib-index';
import { invalidate, libKeys, onInvalidate } from './query-client';
import { getServerBase, kv, settingsStore } from './settings';
import { errorMessage } from './util';
import { isDoc, mergeDocs, sameDoc, type LibraryDoc } from './library-doc';

export { mergeDocs, type LibraryDoc } from './library-doc';

/**
 * Library backup: this device's playlists and likes live on the server under a random library key, so they
 * survive uninstalls and can be restored on another phone or the web app. No accounts: the key is the
 * secret, and the user can show it (text + QR link) to move the library elsewhere.
 *
 * Each sync pulls the server copy, merges it with the device per playlist / per like (newer wins, deletions
 * travel as tombstones), writes the result back here, and pushes it if the server copy differs. Pushes
 * carry the version they were based on; a concurrent change from another device makes the server answer
 * 409 and the sync starts over with the newer copy.
 */

// ---------------------------------------------------------------------------------------------
// Device side

async function readLocal(db: SQLiteDatabase): Promise<LibraryDoc> {
  const [lists, entries, likes, tombs] = await Promise.all([
    db.getAllAsync<{ id: string; name: string; created_at: string; updated_at: string; cover: string | null; import_id: string | null }>(
      'SELECT id, name, created_at, updated_at, cover, import_id FROM playlists',
    ),
    db.getAllAsync<{ playlist_id: string; track: string }>('SELECT playlist_id, track FROM playlist_tracks ORDER BY playlist_id, position'),
    db.getAllAsync<{ key: string; track: string; liked_at: number }>('SELECT key, track, liked_at FROM likes'),
    db.getAllAsync<{ kind: string; id: string; at: number }>('SELECT kind, id, at FROM sync_tombstones'),
  ]);
  const doc: LibraryDoc = { v: 1, playlists: {}, likes: {} };
  const tracksOf = new Map<string, string[]>();
  for (const e of entries) {
    const list = tracksOf.get(e.playlist_id);
    if (list) list.push(e.track);
    else tracksOf.set(e.playlist_id, [e.track]);
  }
  for (const t of tombs) {
    if (t.kind === 'playlist') doc.playlists[t.id] = { deleted: true, updatedAt: t.at };
    else if (t.kind === 'like') doc.likes[t.id] = { deleted: true, at: t.at };
  }
  for (const p of lists) {
    doc.playlists[p.id] = {
      name: p.name,
      createdAt: Date.parse(p.created_at) || 0,
      updatedAt: Date.parse(p.updated_at) || 0,
      cover: p.cover,
      importId: p.import_id,
      tracks: tracksOf.get(p.id) ?? [],
    };
  }
  for (const l of likes) doc.likes[l.key] = { at: l.liked_at, track: l.track };
  return doc;
}

/**
 * Reads the device, merges it with `remoteDoc` and makes the device match the result, all inside one write
 * transaction (writes are serialised), so an edit made while the server request was in flight is never
 * overwritten by a merge computed from a stale read.
 */
async function mergeIntoLocal(remoteDoc: LibraryDoc | null): Promise<LibraryDoc> {
  const changedPlaylists: string[] = [];
  let likesChanged = false;
  const merged = await writeTx(async (db) => {
    const local = await readLocal(db);
    const merged = mergeDocs(local, remoteDoc);
    for (const [id, m] of Object.entries(merged.playlists)) {
      const l = local.playlists[id];
      if (l && JSON.stringify(l) === JSON.stringify(m)) continue;
      changedPlaylists.push(id);
      await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', id);
      await db.runAsync('DELETE FROM playlists WHERE id = ?', id);
      await db.runAsync('DELETE FROM sync_tombstones WHERE kind = ? AND id = ?', 'playlist', id);
      if ('deleted' in m) {
        await db.runAsync('INSERT INTO sync_tombstones (kind, id, at) VALUES (?, ?, ?)', 'playlist', id, m.updatedAt);
        continue;
      }
      await db.runAsync(
        'INSERT INTO playlists (id, name, created_at, updated_at, cover, import_id) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        m.name,
        new Date(m.createdAt).toISOString(),
        new Date(m.updatedAt).toISOString(),
        m.cover,
        m.importId,
      );
      let pos = 0;
      for (const track of m.tracks) {
        const key = keyOf(track);
        if (key) await db.runAsync('INSERT INTO playlist_tracks (playlist_id, position, key, track) VALUES (?, ?, ?, ?)', id, pos++, key, track);
      }
    }
    for (const [key, m] of Object.entries(merged.likes)) {
      const l = local.likes[key];
      if (l && JSON.stringify(l) === JSON.stringify(m)) continue;
      likesChanged = true;
      await db.runAsync('DELETE FROM likes WHERE key = ?', key);
      await db.runAsync('DELETE FROM sync_tombstones WHERE kind = ? AND id = ?', 'like', key);
      if ('deleted' in m) await db.runAsync('INSERT INTO sync_tombstones (kind, id, at) VALUES (?, ?, ?)', 'like', key, m.at);
      else await db.runAsync('INSERT INTO likes (key, track, liked_at) VALUES (?, ?, ?)', key, m.track, m.at);
    }
    return merged;
  });
  if (likesChanged) await loadLibIndexAgain();
  if (changedPlaylists.length || likesChanged) {
    applying = true;
    try {
      invalidate(libKeys.playlists, libKeys.likes, ...changedPlaylists.map(libKeys.playlist));
    } finally {
      applying = false;
    }
  }
  return merged;
}

function keyOf(track: string): string | null {
  try {
    const t = JSON.parse(track) as { key?: unknown };
    return typeof t.key === 'string' ? t.key : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Key

const K_KEY = 'sync.libraryKey';
const K_LAST = 'sync.lastSyncedAt';
const K_PREVIOUS = 'sync.previousLibraryKey';
/** No 0/O, 1/I/L or U, so a key read aloud or typed from a screenshot comes out right. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const KEY_LENGTH = 25;

function newKey(): string {
  // 30 symbols; rejection-sample bytes to stay uniform. 25 symbols ≈ 122 bits.
  let out = '';
  while (out.length < KEY_LENGTH) {
    for (const b of getRandomBytes(32)) {
      if (b < 240 && out.length < KEY_LENGTH) out += ALPHABET[b % 30];
    }
  }
  return out;
}

/** The key as typed or pasted: separators and case ignored. Null unless it is a valid key. */
export function normalizeLibraryKey(raw: string): string | null {
  const k = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k.length === KEY_LENGTH && [...k].every((c) => ALPHABET.includes(c)) ? k : null;
}

/** `ABCDE-FGHJK-…` for display. */
export const formatLibraryKey = (k: string) => k.match(/.{1,5}/g)!.join('-');

// ---------------------------------------------------------------------------------------------
// State + sync loop

type SyncState = {
  key: string | null;
  status: 'off' | 'syncing' | 'ok' | 'error';
  error: string | null;
  lastSyncedAt: number | null;
};

export const librarySyncStore = create<SyncState>(() => ({
  key: kv.getString(K_KEY) ?? null,
  status: 'off',
  error: null,
  lastSyncedAt: kv.getNumber(K_LAST) ?? null,
}));

export function useLibrarySync(): SyncState {
  return useStore(librarySyncStore, (s) => s);
}

type RemoteCopy = { version: number; data: unknown };

async function request<T>(method: 'GET' | 'PUT', key: string, body?: unknown): Promise<{ status: number; json: T | null }> {
  const base = getServerBase();
  const token = settingsStore.getState().accessToken;
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Library-Key': key };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${base}/api/library`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      credentials: 'include',
    });
    const json = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      const msg = (json as { error?: unknown } | null)?.error;
      throw new ApiError(typeof msg === 'string' ? msg : `HTTP ${res.status}`, res.status);
    }
    return { status: res.status, json };
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError('Server did not respond in time');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const NEWER_FORMAT = 'This library was saved by a newer Blednify. Update the app to sync it.';

async function syncOnce(key: string): Promise<void> {
  let { status, json } = await request<RemoteCopy>('GET', key);
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = status === 404 || !json ? null : json;
    // A copy this version can't read (a newer app's format) must never be overwritten with this device's data.
    if (remote && remote.data != null && !isDoc(remote.data)) throw new ApiError(NEWER_FORMAT);
    const remoteDoc = remote && isDoc(remote.data) ? remote.data : null;
    const merged = await mergeIntoLocal(remoteDoc);
    if (sameDoc(merged, remoteDoc)) return;
    const put = await request<RemoteCopy>('PUT', key, { baseVersion: remote?.version ?? 0, data: merged });
    if (put.status !== 409) return;
    // Another device pushed in between: merge with the copy the server sent back and try again.
    ({ status, json } = put);
  }
  throw new ApiError('Library keeps changing on the server; will retry');
}

let running: Promise<void> | null = null;
let again = false;
let applying = false;

/** Sync now (coalesced: a call during a sync schedules one more pass). */
export function syncLibrary(): Promise<void> {
  const { key } = librarySyncStore.getState();
  if (!key || !getServerBase()) {
    librarySyncStore.setState({ status: 'off' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  librarySyncStore.setState({ status: 'syncing' });
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce(librarySyncStore.getState().key!);
      } while (again);
      const now = Date.now();
      kv.set(K_LAST, now);
      librarySyncStore.setState({ status: 'ok', error: null, lastSyncedAt: now });
    } catch (e) {
      librarySyncStore.setState({ status: 'error', error: errorMessage(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * `restored`: switched and synced. `empty`: the server has no library under that key (nothing switched unless
 * `allowEmpty`). `failed`: the key wasn't switched (server unreachable, unreadable copy) or, with `switched`, the
 * first sync failed and will retry. `previousKey` is the key this device used before.
 */
export type SwitchResult =
  | { status: 'restored'; previousKey: string | null }
  | { status: 'empty' }
  | { status: 'failed'; error: string; switched: boolean; previousKey?: string | null };

/**
 * Switch this device to another library (restore on a new phone). What is on the device now is merged into
 * that library rather than dropped. The key is checked on the server first, so a typo or an outage doesn't
 * silently start a new, empty library.
 */
export async function switchLibraryKey(raw: string, opts: { allowEmpty?: boolean } = {}): Promise<SwitchResult> {
  const key = normalizeLibraryKey(raw);
  if (!key) return { status: 'failed', error: 'That isn’t a library key', switched: false };
  if (!getServerBase()) return { status: 'failed', error: 'Connect to your server first', switched: false };
  try {
    const probe = await request<RemoteCopy>('GET', key);
    if ((probe.status === 404 || !probe.json) && !opts.allowEmpty) return { status: 'empty' };
    if (probe.json && probe.json.data != null && !isDoc(probe.json.data))
      return { status: 'failed', error: NEWER_FORMAT, switched: false };
  } catch (e) {
    return { status: 'failed', error: errorMessage(e), switched: false };
  }
  const previousKey = librarySyncStore.getState().key;
  if (previousKey && previousKey !== key) kv.set(K_PREVIOUS, previousKey);
  kv.set(K_KEY, key);
  kv.remove(K_LAST);
  librarySyncStore.setState({ key, lastSyncedAt: null });
  await syncLibrary();
  const after = librarySyncStore.getState();
  if (after.status === 'error') return { status: 'failed', error: after.error ?? 'Sync failed', switched: true, previousKey };
  return { status: 'restored', previousKey };
}

let timer: ReturnType<typeof setTimeout> | null = null;
function syncSoon(delayMs = 2500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncLibrary();
  }, delayMs);
}

let started = false;

/** Creates the key on first run, then syncs at start, on foreground, after library edits and on server change. */
export function startLibrarySync(): void {
  if (started) return;
  started = true;
  if (!librarySyncStore.getState().key) {
    const key = newKey();
    kv.set(K_KEY, key);
    librarySyncStore.setState({ key });
  }
  void syncLibrary();
  AppState.addEventListener('change', (s) => {
    if (s === 'active') syncSoon(500);
  });
  settingsStore.subscribe((s, prev) => {
    if (s.serverUrl !== prev.serverUrl || s.accessToken !== prev.accessToken) syncSoon(500);
  });
  onInvalidate((keys) => {
    if (applying) return;
    if (keys.some((k) => k[0] === 'lib' && (k[1] === 'likes' || k[1] === 'playlists' || k[1] === 'playlist'))) syncSoon();
  });
}

