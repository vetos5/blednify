/**
 * Android Auto.
 *
 * expo-audio's playback service is patched into a Media3 MediaLibraryService (patches/expo-audio@*.patch,
 * service/AutoLibrary.kt). The car browses a snapshot of the library that we publish here, and when the
 * driver picks something, native sends us an `onAutoRequest` and we build the queue exactly like a tap
 * in the app would. This module is imported by the app entry (index.ts) so that it also runs when the
 * car starts the app headless, before any screen exists.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { apiGet, queryString, type ApiSearch } from './api';
import { fetchLikes, fetchLocalLibrary, fetchPlaylist, fetchPlaylists, fetchRecents, searchLocal } from './library';
import { player } from './player/engine';
import { playerStore } from './player/store';
import { libKeys, onInvalidate } from './query-client';
import { getServerBase } from './settings';
import { startCore, whenCoreReady } from './startup';
import { dedupeByKey, fromApiTrack, resolveTrack } from './tracks';
import type { AppTrack } from './types';
import { errorMessage } from './util';

type AutoRequest = { type: 'play' | 'search' | 'resume'; value: string };

type AutoNative = {
  setAutoLibrary(json: string): void;
  takeAutoRequests(): AutoRequest[];
  addListener(event: 'onAutoRequest', listener: (r: AutoRequest) => void): { remove(): void };
};

/** One browse node; `kids` makes it a folder. Mirrors AutoLibrary.parse on the native side. */
type Node = { id: string; title: string; sub?: string; play?: boolean; kids?: Node[] };

const native = Platform.OS === 'android' ? requireOptionalNativeModule<AutoNative>('ExpoAudio') : null;

/** Tracks per list in the car. Driving UIs cap long lists anyway; this keeps the snapshot small. */
const LIST_CAP = 300;
const RECENT_LIMIT = 50;
const PUBLISH_DEBOUNCE_MS = 2_000;
/** Recents change with every song played; the car's Recent folder can lag a little behind. */
const RECENTS_DEBOUNCE_MS = 60_000;
/** First publish waits until the app has settled after a cold start. */
const FIRST_PUBLISH_DELAY_MS = 5_000;
const SHUFFLE = '*shuffle';
const SEP = '|';

const LISTS = { recent: 'recent', liked: 'liked', offline: 'offline', playlists: 'playlists' } as const;
const playlistList = (id: string) => `pl:${id}`;

// --- Browse tree -------------------------------------------------------------------------------

function trackNodes(list: string, tracks: readonly AppTrack[], shuffle: boolean): Node[] {
  const unique = dedupeByKey(tracks).slice(0, LIST_CAP);
  const nodes: Node[] = unique.map((t) => ({ id: `${list}${SEP}${t.key}`, title: t.title, sub: t.artist }));
  if (shuffle && unique.length > 1) nodes.unshift({ id: `${list}${SEP}${SHUFFLE}`, title: 'Shuffle all', play: true });
  return nodes;
}

async function buildTree(): Promise<Node[]> {
  const [recents, likes, offline, playlists] = await Promise.all([
    fetchRecents(RECENT_LIMIT),
    fetchLikes(),
    fetchLocalLibrary(),
    fetchPlaylists(),
  ]);
  const playlistNodes: Node[] = [];
  for (const row of playlists.rows) {
    const { tracks } = await fetchPlaylist(row.id);
    const list = playlistList(row.id);
    playlistNodes.push({
      id: list,
      title: row.name,
      sub: row.track_count === 1 ? '1 song' : `${row.track_count} songs`,
      kids: trackNodes(list, tracks, true),
    });
  }
  return [
    { id: LISTS.recent, title: 'Recent', kids: trackNodes(LISTS.recent, recents, false) },
    { id: LISTS.liked, title: 'Liked', kids: trackNodes(LISTS.liked, likes, true) },
    { id: LISTS.playlists, title: 'Playlists', kids: playlistNodes },
    { id: LISTS.offline, title: 'Offline', kids: trackNodes(LISTS.offline, offline, true) },
  ];
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;
let publishing = false;
let publishAgain = false;
/** Last snapshot handed to native; an unchanged tree isn't parsed and written again. */
let lastPublished = '';

async function publish() {
  if (!native) return;
  if (publishing) {
    publishAgain = true;
    return;
  }
  publishing = true;
  try {
    const json = JSON.stringify(await buildTree());
    if (json !== lastPublished) {
      native.setAutoLibrary(json);
      lastPublished = json;
    }
  } catch (e) {
    console.warn('[auto] could not publish library', errorMessage(e));
  } finally {
    publishing = false;
    if (publishAgain) {
      publishAgain = false;
      schedulePublish();
    }
  }
}

let publishDue = 0;

/** Publish after `delay`; an earlier pending publish wins, so a slow schedule never postpones a fast one. */
function schedulePublish(delay = PUBLISH_DEBOUNCE_MS) {
  const due = Date.now() + delay;
  if (publishTimer) {
    if (publishDue <= due && delay !== PUBLISH_DEBOUNCE_MS) return;
    clearTimeout(publishTimer);
  }
  publishDue = due;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publish();
  }, delay);
}

// --- Requests from the car ---------------------------------------------------------------------

async function listTracks(list: string): Promise<AppTrack[]> {
  if (list === LISTS.recent) return fetchRecents(RECENT_LIMIT);
  if (list === LISTS.liked) return fetchLikes();
  if (list === LISTS.offline) return fetchLocalLibrary();
  if (list.startsWith('pl:')) return (await fetchPlaylist(list.slice(3))).tracks;
  return [];
}

async function playFromList(list: string, key: string) {
  const tracks = dedupeByKey(await listTracks(list)).map((t) => resolveTrack(t));
  if (!tracks.length) return;
  if (key === SHUFFLE) {
    player.playTracks(tracks, undefined, { shuffle: true });
    return;
  }
  player.playTracks(tracks, Math.max(0, tracks.findIndex((t) => t.key === key)));
}

/** Voice: "play <query> on Blednify". An empty query means "play something". */
async function playSearch(query: string) {
  const q = query.trim();
  if (!q) {
    await resume();
    return;
  }
  let found: AppTrack[] = [];
  const base = getServerBase();
  if (base) {
    try {
      const res = await apiGet<ApiSearch>(base, `/api/search${queryString({ q, limit: 50 })}`, undefined, 8_000);
      found = res.tracks.map((t) => fromApiTrack(t, base));
    } catch (e) {
      console.warn('[auto] server search failed', errorMessage(e));
    }
  }
  found = dedupeByKey([...found, ...(await searchLocal(q, 50))]).map((t) => resolveTrack(t));
  if (found.length) player.playTracks(found, 0);
}

async function resume() {
  if (playerStore.getState().current) {
    player.play();
    return;
  }
  await playFromList(LISTS.liked, SHUFFLE);
}

async function handle(r: AutoRequest) {
  try {
    await startCore();
    if (r.type === 'resume') return await resume();
    if (r.type === 'search') return await playSearch(r.value);
    const at = r.value.indexOf(SEP);
    if (at > 0) await playFromList(r.value.slice(0, at), r.value.slice(at + 1));
  } catch (e) {
    console.warn('[auto] request failed', r, errorMessage(e));
  }
}

// --- Wiring ------------------------------------------------------------------------------------

if (native) {
  native.addListener('onAutoRequest', (r) => void handle(r));
  // Requests that arrived before JS was listening (the car started the app).
  for (const r of native.takeAutoRequests()) void handle(r);

  whenCoreReady(() => schedulePublish(FIRST_PUBLISH_DELAY_MS));
  onInvalidate((keys) => {
    const lib = keys.filter((k) => k[0] === libKeys.all[0]);
    if (!lib.length) return;
    const recentsOnly = lib.every((k) => k[1] === libKeys.recents[1]);
    schedulePublish(recentsOnly ? RECENTS_DEBOUNCE_MS : PUBLISH_DEBOUNCE_MS);
  });
}
