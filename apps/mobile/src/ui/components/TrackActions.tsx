import { View } from 'react-native';

import {
  cancelDownload,
  deleteFromServer,
  downloadTracks,
  player,
  removeDownload,
  removeFromPlaylist,
  toggleLike,
  uploadLocalTracks,
  useDownloadState,
  useIsLiked,
  useSettings,
  type AppTrack,
  type DownloadStatus,
  fileStorageSupported,
} from '@/core';

import { attempt, confirmDeleteLocal } from '../actions';
import { nav } from '../nav';
import { showSheet, showToast, type SheetAnchor } from '../overlay';
import { openEditTrack } from './ArtistAdmin';
import { confirm } from './ConfirmSheet';
import { useColors } from '../theme';
import { SheetAction, SheetHeader } from './ActionSheet';
import { PlaylistPicker } from './PlaylistPicker';
import { openShare } from './ShareSheet';
import { Text } from './Text';

export type TrackActionContext = {
  /** Present when opened from a playlist: enables "Remove from this playlist". */
  playlist?: { id: string; index: number };
  /** Hide navigation shortcuts when already on that screen. */
  hideAlbum?: boolean;
  hideArtist?: boolean;
  /** Called before navigating away (e.g. to dismiss a modal). */
  beforeNavigate?: () => void;
  /** Wide layout: open as a context menu at this point (right-click). */
  anchor?: SheetAnchor;
};

/** Open the long-press / "more" action sheet for a track. */
export function openTrackActions(track: AppTrack, context: TrackActionContext = {}) {
  showSheet(<TrackActions track={track} context={context} />, { anchor: context.anchor });
}

/** Stable `onMore` handler for TrackRow when no extra context is needed. */
export function onTrackMore(track: AppTrack, _index?: number, anchor?: SheetAnchor) {
  openTrackActions(track, { anchor });
}

function TrackActions({ track, context }: { track: AppTrack; context: TrackActionContext }) {
  const colors = useColors();
  const liked = useIsLiked(track.key);
  const { adminMode, adminToken } = useSettings();
  const admin = adminMode && !!adminToken;
  const download = useDownloadState(track.key);
  const { playlist } = context;
  const go = (fn: () => void) => {
    context.beforeNavigate?.();
    fn();
  };

  return (
    <View>
      <SheetHeader
        title={track.title}
        subtitle={`${track.artist} · ${track.album}`}
        artworkUri={track.artworkUri}
        artworkLabel={track.album || track.title}
      />
      <SheetAction
        icon="play-forward-outline"
        label="Play next"
        onPress={() => {
          player.playNext([track]);
          showToast('Playing next');
        }}
      />
      <SheetAction
        icon="list-outline"
        label="Add to queue"
        onPress={() => {
          player.addToQueue([track]);
          showToast('Added to queue');
        }}
      />
      <SheetAction icon="add-circle-outline" label="Add to playlist" keepOpen onPress={() => showSheet(<PlaylistPicker tracks={[track]} />)} />
      {track.origin === 'remote' ? (
        <SheetAction
          icon="share-outline"
          label="Share"
          keepOpen
          onPress={() =>
            openShare({ target: { kind: 'track', id: track.id }, title: track.title, subtitle: track.artist, artworkUri: track.artworkUri })
          }
        />
      ) : null}
      <SheetAction
        icon={liked ? 'heart' : 'heart-outline'}
        iconColor={liked ? colors.accent : undefined}
        label={liked ? 'Remove from Liked' : 'Like'}
        onPress={() => void attempt(toggleLike(track), liked ? 'Removed from Liked' : 'Added to Liked')}
      />
      {fileStorageSupported && track.origin === 'remote' ? <DownloadAction track={track} status={download.status} progress={download.progress} /> : null}
      {playlist ? (
        <SheetAction
          icon="remove-circle-outline"
          label="Remove from this playlist"
          onPress={() => void attempt(removeFromPlaylist(playlist.id, playlist.index), 'Removed from playlist')}
        />
      ) : null}
      {!context.hideAlbum && track.album ? (
        <SheetAction icon="disc-outline" label="Go to album" onPress={() => go(() => nav.album(track.albumId, track.origin))} />
      ) : null}
      {!context.hideArtist ? (
        <SheetAction icon="person-outline" label="Go to artist" onPress={() => go(() => nav.artist(track.artistId, track.origin))} />
      ) : null}
      {admin && track.origin === 'local' ? (
        <SheetAction
          icon="cloud-upload-outline"
          label="Upload to server"
          onPress={() => {
            uploadLocalTracks([track]);
            showToast('Uploading to server');
          }}
        />
      ) : null}
      {admin && track.origin === 'remote' ? (
        <SheetAction icon="pencil-outline" label="Edit info" keepOpen onPress={() => openEditTrack(track)} />
      ) : null}
      {admin && track.origin === 'remote' ? (
        <SheetAction icon="trash-outline" label="Delete from server" destructive onPress={() => confirmDeleteFromServer(track)} />
      ) : null}
      {track.origin === 'local' ? (
        <SheetAction icon="trash-outline" label="Delete from device" destructive onPress={() => confirmDeleteLocal(track)} />
      ) : null}
    </View>
  );
}

function confirmDeleteFromServer(track: AppTrack) {
  confirm({
    title: 'Delete from server?',
    message: `“${track.title}” will be deleted from the server’s music folder for everyone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => void attempt(deleteFromServer(track), 'Deleted from server'),
  });
}

function DownloadAction({ track, status, progress }: { track: AppTrack; status: DownloadStatus; progress: number }) {
  const colors = useColors();
  if (status === 'done') {
    return <SheetAction icon="trash-outline" label="Remove download" onPress={() => void attempt(removeDownload(track.key), 'Download removed')} />;
  }
  if (status === 'queued' || status === 'downloading') {
    return (
      <SheetAction
        icon="close-circle-outline"
        label="Cancel download"
        onPress={() => cancelDownload(track.key)}
        trailing={
          <Text variant="mono" color={colors.accent}>
            {Math.round(progress * 100)}%
          </Text>
        }
      />
    );
  }
  return (
    <SheetAction
      icon="arrow-down-circle-outline"
      label={status === 'error' ? 'Retry download' : 'Download'}
      onPress={() => {
        downloadTracks([track]);
        showToast('Downloading');
      }}
    />
  );
}
