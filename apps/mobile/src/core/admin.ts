import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { create, useStore } from 'zustand';

import { ApiError, toApiError, type ApiArtist, type ApiTrack } from './api';
import { pruneGoneTracks, refreshTrackCopies } from './prune';
import { queryClient } from './query-client';
import { getServerBase, normalizeServerUrl, settingsStore } from './settings';
import type { AppTrack } from './types';
import { errorMessage, extForMime, extOf, randomId } from './util';

/** Admin requests carry only the admin token: the server accepts writes without the listen token. */
export async function adminRequest<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: { base?: string; token?: string; timeoutMs?: number; body?: unknown } = {},
): Promise<T> {
  const base = opts.base ?? getServerBase();
  const token = (opts.token ?? settingsStore.getState().adminToken).trim();
  if (!base) throw new ApiError('No server configured');
  if (!token) throw new ApiError('Enter the admin token in Settings');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(base + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new ApiError(await errorFrom(res), res.status);
    return (res.status === 204 ? undefined : await res.json()) as T;
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError('Server did not respond in time');
    throw toApiError(e);
  } finally {
    clearTimeout(timer);
  }
}

async function errorFrom(res: Response): Promise<string> {
  if (res.status === 401) return 'Admin token was rejected';
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}`;
}

/** Refetch everything that comes from the server after the library changed. */
export function refreshCatalog() {
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'lib' });
}

// --- Check / rescan / delete -----------------------------------------------------------------

type AdminInfo = { maxUploadBytes: number; imports: boolean };
export const adminInfo = create<{ info: AdminInfo | null }>(() => ({ info: null }));

/** Verifies an admin token against a server (before or after saving it). */
export async function checkAdmin(url?: string, token?: string): Promise<{ ok: boolean; maxUploadBytes?: number; error?: string }> {
  try {
    const base = url !== undefined ? normalizeServerUrl(url) : undefined;
    const r = await adminRequest<{ ok: boolean; maxUploadBytes: number; imports?: boolean }>('POST', '/api/admin/check', { base, token });
    adminInfo.setState({ info: { maxUploadBytes: r.maxUploadBytes, imports: !!r.imports } });
    return { ok: true, maxUploadBytes: r.maxUploadBytes };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { ok: false, error: 'Server is too old for uploads; update it' };
    if (e instanceof ApiError && e.status === 403) return { ok: false, error: 'Uploads are disabled: set ADMIN_TOKEN on the server' };
    return { ok: false, error: errorMessage(e) };
  }
}

export async function rescanServer(): Promise<{ added: number; removed: number; total: number }> {
  const r = await adminRequest<{ added: number; removed: number; total: number }>('POST', '/api/rescan', { timeoutMs: 10 * 60_000 });
  refreshCatalog();
  void pruneGoneTracks(true);
  return r;
}

/**
 * Deletes a server track's file and index entry, and drops it from likes, recents, playlists and the queue.
 * A downloaded copy on this phone stays everywhere and keeps playing.
 */
export async function deleteFromServer(track: AppTrack): Promise<void> {
  if (track.origin !== 'remote') return;
  await adminRequest<void>('DELETE', `/api/tracks/${encodeURIComponent(track.id)}`);
  refreshCatalog();
  await pruneGoneTracks(true);
}

// --- Track info / artist merges ------------------------------------------------------------

export type TrackEdit = { title?: string | null; artist?: string | null; album?: string | null };

/** After an edit or merge: refetch the catalog and update the copies in likes, playlists, recents and the queue. */
async function afterInfoChange() {
  refreshCatalog();
  await refreshTrackCopies();
}

/** Changes a server track's title/artist/album (the file keeps its tags). null restores a field from the tags. */
export async function editTrackInfo(track: AppTrack, edit: TrackEdit): Promise<ApiTrack> {
  const r = await adminRequest<ApiTrack>('PATCH', `/api/tracks/${encodeURIComponent(track.id)}`, { body: edit });
  await afterInfoChange();
  return r;
}

export type ApiArtistDetail = ApiArtist & { albums: unknown[]; tracks: ApiTrack[] };
export type MergeSuggestion = { a: ApiArtist; b: ApiArtist; score: number };

/** Shows the artists as one (the first keeps its page), named `name`. */
export async function mergeArtists(ids: string[], name: string): Promise<ApiArtistDetail> {
  const r = await adminRequest<ApiArtistDetail>('POST', '/api/admin/artists/merge', { body: { ids, name } });
  await afterInfoChange();
  return r;
}

export async function renameArtist(id: string, name: string): Promise<ApiArtistDetail> {
  const r = await adminRequest<ApiArtistDetail>('POST', `/api/admin/artists/${encodeURIComponent(id)}/rename`, { body: { name } });
  await afterInfoChange();
  return r;
}

export async function unmergeArtist(id: string): Promise<ApiArtistDetail> {
  const r = await adminRequest<ApiArtistDetail>('POST', `/api/admin/artists/${encodeURIComponent(id)}/unmerge`);
  await afterInfoChange();
  return r;
}

export async function fetchMergeSuggestions(): Promise<MergeSuggestion[]> {
  const r = await adminRequest<{ items: MergeSuggestion[] }>('POST', '/api/admin/artists/suggestions', { timeoutMs: 30_000 });
  return r.items;
}

export async function dismissMergeSuggestion(aId: string, bId: string): Promise<void> {
  await adminRequest<void>('POST', '/api/admin/artists/suggestions/dismiss', { body: { ids: [aId, bId] } });
  void queryClient.invalidateQueries({ queryKey: ['merge-suggestions'] });
}

// --- Uploads ---------------------------------------------------------------------------------

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';
export type UploadItem = {
  id: string;
  name: string;
  sizeBytes: number;
  status: UploadStatus;
  progress: number;
  error?: string;
  /** "Title · Artist" as the server indexed it. */
  result?: string;
};

type Job = { uri: string; name: string; mime: string; temp: boolean };

const uploadStore = create<{ items: UploadItem[] }>(() => ({ items: [] }));
const jobs = new Map<string, Job>();
let current: { id: string; xhr: XMLHttpRequest } | null = null;
let pumping = false;

function patch(id: string, p: Partial<UploadItem>) {
  uploadStore.setState((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
}

function discardTemp(job: Job | undefined) {
  if (!job?.temp) return;
  try {
    const f = new File(job.uri);
    if (f.exists) f.delete();
  } catch {
    // cache is purged by the OS eventually
  }
}

function enqueue(job: Job, sizeBytes: number) {
  const id = randomId();
  jobs.set(id, job);
  const max = adminInfo.getState().info?.maxUploadBytes;
  const tooBig = !!max && sizeBytes > max;
  uploadStore.setState((s) => ({
    items: [
      ...s.items,
      {
        id,
        name: job.name,
        sizeBytes,
        status: tooBig ? 'error' : 'queued',
        progress: 0,
        error: tooBig ? `Larger than the server limit (${Math.round(max! / 1048576)} MB)` : undefined,
      },
    ],
  }));
  if (tooBig) {
    discardTemp(job);
    jobs.delete(id);
  }
}

function send(id: string, job: Job): Promise<ApiTrack[]> {
  return new Promise((resolve, reject) => {
    const base = getServerBase();
    const token = settingsStore.getState().adminToken.trim();
    if (!base) return reject(new Error('No server configured'));
    if (!token) return reject(new Error('Enter the admin token in Settings'));
    const xhr = new XMLHttpRequest();
    current = { id, xhr };
    xhr.open('POST', `${base}/api/tracks`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    let last = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !e.total) return;
      const now = Date.now();
      if (now - last < 200 && e.loaded < e.total) return;
      last = now;
      patch(id, { progress: Math.min(0.99, e.loaded / e.total) });
    };
    xhr.onload = () => {
      let body: { items?: ApiTrack[]; error?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body?.items ?? []);
      if (xhr.status === 401) return reject(new Error('Admin token was rejected'));
      if (xhr.status === 413 && !body?.error) return reject(new Error('File is larger than the server allows'));
      reject(new Error(body?.error ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onabort = () => reject(new Error('Cancelled'));
    xhr.timeout = 30 * 60_000;
    const form = new FormData();
    // React Native's FormData streams the file from its URI.
    form.append('file', { uri: job.uri, name: job.name, type: job.mime } as unknown as Blob);
    xhr.send(form);
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = uploadStore.getState().items.find((it) => it.status === 'queued');
      if (!next) break;
      const job = jobs.get(next.id);
      if (!job) {
        patch(next.id, { status: 'error', error: 'File is gone' });
        continue;
      }
      patch(next.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const items = await send(next.id, job);
        const t = items[0];
        patch(next.id, { status: 'done', progress: 1, result: t ? `${t.title} · ${t.artist}` : undefined });
        jobs.delete(next.id);
        discardTemp(job);
        refreshCatalog();
      } catch (e) {
        patch(next.id, { status: 'error', error: errorMessage(e) });
      } finally {
        current = null;
      }
    }
  } finally {
    pumping = false;
  }
}

/** Opens the system picker and uploads the chosen audio files to the server, one at a time. */
export async function pickAndUpload(): Promise<number> {
  if (!adminInfo.getState().info) void checkAdmin();
  const res = await getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return 0;
  for (const a of res.assets) {
    const ext = extOf(a.name) || extForMime(a.mimeType);
    const mime = a.mimeType?.startsWith('audio/') ? a.mimeType : 'application/octet-stream';
    enqueue({ uri: a.uri, name: a.name || `upload.${ext}`, mime, temp: true }, a.size ?? 0);
  }
  void pump();
  return res.assets.length;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();

/** Uploads imported (on-device) tracks to the server. The local copies stay. */
export function uploadLocalTracks(tracks: AppTrack[]): number {
  let n = 0;
  for (const t of tracks) {
    if (t.origin !== 'local' || !t.localUri) continue;
    const ext = extOf(t.localUri) || extForMime(t.mimeType);
    const stem = safeName(t.artist && t.artist !== 'Unknown Artist' ? `${t.artist} - ${t.title}` : t.title) || 'upload';
    enqueue({ uri: t.localUri, name: `${stem}.${ext}`, mime: t.mimeType, temp: false }, t.sizeBytes);
    n++;
  }
  if (n) void pump();
  return n;
}

export function retryUpload(id: string) {
  if (!jobs.has(id)) return;
  patch(id, { status: 'queued', progress: 0, error: undefined });
  void pump();
}

export function cancelUpload(id: string) {
  if (current?.id === id) current.xhr.abort();
  const item = uploadStore.getState().items.find((it) => it.id === id);
  if (item?.status === 'queued') patch(id, { status: 'error', error: 'Cancelled' });
}

/** Removes finished and failed rows. */
export function clearUploads() {
  const keep = uploadStore.getState().items.filter((it) => it.status === 'queued' || it.status === 'uploading');
  for (const it of uploadStore.getState().items) {
    if (keep.includes(it)) continue;
    discardTemp(jobs.get(it.id));
    jobs.delete(it.id);
  }
  uploadStore.setState({ items: keep });
}

/** What the server reported on the last admin check (null until checked). */
export function useAdminInfo(): AdminInfo | null {
  return useStore(adminInfo, (s) => s.info);
}

export function useUploads(): { items: UploadItem[]; active: number; maxUploadBytes: number | null } {
  const items = useStore(uploadStore, (s) => s.items);
  const info = useStore(adminInfo, (s) => s.info);
  return {
    items,
    active: items.filter((it) => it.status === 'queued' || it.status === 'uploading').length,
    maxUploadBytes: info?.maxUploadBytes ?? null,
  };
}
