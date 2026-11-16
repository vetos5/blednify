/**
 * Audio backend used by the engine. Native: expo-audio (ExoPlayer / AVQueuePlayer).
 * Web: `audio.web.ts`, a single-<audio>-element playlist (see there for why not expo-audio's web playlist).
 */
import type { AudioMetadata, AudioPlaylist } from 'expo-audio';

export {
  createAudioPlaylist,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioMetadata,
  type AudioPlaylist,
  type AudioPlaylistStatus,
} from 'expo-audio';

export type EditSource = { uri: string; name?: string; headers?: Record<string, string> };
export type PlaylistEdit =
  | { op: 'clear' }
  | { op: 'add'; source: EditSource }
  | { op: 'insert'; index: number; source: EditSource }
  | { op: 'remove'; index: number }
  | { op: 'skipTo'; index: number };

/** Op codes of the patched native `editWindow` (expo-audio patch, AudioPlaylist.kt). */
const OP_CODE = { clear: 0, add: 1, insert: 2, remove: 3, skipTo: 4 } as const;

type PatchedPlaylist = {
  editWindow(ops: number[], sources: EditSource[], metadata: AudioMetadata | null): void;
  addListener(event: 'remoteSkip', fn: (e: { direction: string }) => void): { remove(): void };
};

/**
 * Applies `edits` in one native call (patched expo-audio): no media key or notification button can land half way
 * through, and the lock-screen session stays attached. `metadata` (when the lock screen is active) replaces the
 * lock-screen metadata.
 */
export function editPlaylist(p: AudioPlaylist, edits: PlaylistEdit[], metadata: AudioMetadata | null): void {
  const ops: number[] = [];
  const sources: EditSource[] = [];
  for (const e of edits) {
    ops.push(OP_CODE[e.op], 'index' in e ? e.index : -1);
    if ('source' in e) sources.push(e.source);
  }
  (p as unknown as PatchedPlaylist).editWindow(ops, sources, metadata);
}

/**
 * Skips from the lock screen / notification / media keys that the native window could not serve (patched
 * expo-audio, PlaylistSessionPlayer.kt).
 */
export function addRemoteSkipListener(p: AudioPlaylist, fn: (direction: 'next' | 'previous') => void): { remove(): void } {
  return (p as unknown as PatchedPlaylist).addListener('remoteSkip', (e) => {
    if (e?.direction === 'next' || e?.direction === 'previous') fn(e.direction);
  });
}
