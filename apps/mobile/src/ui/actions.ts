
import { deleteLocalTrack, importFromDevice, insertIntoPlaylist, player, removeFromPlaylist, type AppTrack } from '@/core';
import { playerStore } from '@/core/player/store';

import { haptics } from './haptics';
import { confirm } from './components/ConfirmSheet';
import { dismissToast, showToast } from './overlay';
import { plural } from '@/ui/format';

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return typeof e === 'string' && e ? e : 'Something went wrong';
}

/** Await a core mutation, surfacing failures as an error toast and success as an optional toast. */
export async function attempt<T>(task: Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await task;
    if (success) showToast(success, 'success');
    return result;
  } catch (e) {
    haptics.warn();
    showToast(errorMessage(e), 'error');
    return undefined;
  }
}

/** Removes a track from a playlist and offers an Undo toast that puts it back in the same place. */
export async function removeFromPlaylistWithUndo(playlistId: string, index: number, track: AppTrack) {
  try {
    await removeFromPlaylist(playlistId, index);
  } catch (e) {
    haptics.warn();
    showToast(errorMessage(e), 'error');
    return;
  }
  showToast('Removed from playlist', 'success', {
    label: 'Undo',
    onPress: () => void attempt(insertIntoPlaylist(playlistId, index, track)),
  });
}

/** Removes an upcoming song from the queue and offers an Undo toast that puts it back in the same place. */
export function removeFromQueueWithUndo(abs: number) {
  const { queue, index } = playerStore.getState();
  const track = queue[abs];
  if (!track) return;
  // Remember where the song sat relative to the playing one: the queue may have moved on by the time Undo is tapped.
  const offset = abs - index;
  player.removeFromQueue(abs);
  if (offset <= 0) {
    showToast('Removed from queue', 'success');
    return;
  }
  showToast('Removed from queue', 'success', {
    label: 'Undo',
    onPress: () => {
      const now = playerStore.getState();
      if (!now.queue.length) return player.playTracks([track], 0);
      player.playNext([track]);
      const to = Math.min(now.index + offset, now.queue.length);
      if (to > now.index + 1) player.moveInQueue(now.index + 1, to);
    },
  });
}

let importing = false;

/** Opens the system picker and imports audio files with progress + result toasts. */
export async function importMusic() {
  if (importing) return;
  importing = true;
  const toastId = showToast('Importing music…', 'progress');
  try {
    const { imported, skipped } = await importFromDevice();
    dismissToast(toastId);
    if (imported === 0 && skipped === 0) return; // picker cancelled
    haptics.success();
    const parts = [`Imported ${plural(imported, 'song')}`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    showToast(parts.join(' · '), imported > 0 ? 'success' : 'info');
  } catch (e) {
    dismissToast(toastId);
    haptics.warn();
    showToast(errorMessage(e), 'error');
  } finally {
    importing = false;
  }
}

export function confirmDeleteLocal(track: AppTrack) {
  confirm({
    title: 'Delete from device?',
    message: `“${track.title}” will be removed from this phone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => void attempt(deleteLocalTrack(track.key), 'Deleted from device'),
  });
}
