import { View } from 'react-native';

import { createPlaylist, deletePlaylist, renamePlaylist, shareableIds, type AppTrack, type Playlist } from '@/core';

import { attempt } from '../actions';
import { nav } from '../nav';
import { showSheet, type SheetAnchor } from '../overlay';
import { confirm } from './ConfirmSheet';
import { SheetAction, SheetHeader } from './ActionSheet';
import { PromptSheet } from './PromptSheet';
import { openShare } from './ShareSheet';
import { plural } from '@/ui/format';

/** Ask for a name, create the playlist and open it. */
export function promptNewPlaylist() {
  showSheet(
    <PromptSheet
      title="New playlist"
      placeholder="Playlist name"
      submitLabel="Create"
      onSubmit={async (name) => {
        const id = await attempt(createPlaylist(name));
        if (id) nav.playlist(id);
      }}
    />,
  );
}

export function openPlaylistActions(
  p: Playlist,
  opts: { onDeleted?: () => void; anchor?: SheetAnchor; tracks?: readonly AppTrack[] } = {},
) {
  // Only songs on the server can be opened by someone else.
  const shareable = opts.tracks ? shareableIds(opts.tracks) : [];
  showSheet(
    <View>
      <SheetHeader title={p.name} subtitle={plural(p.trackCount, 'song')} />
      {shareable.length ? (
        <SheetAction
          icon="share-outline"
          label={shareable.length < p.trackCount ? `Share ${shareable.length} server songs` : 'Share'}
          keepOpen
          onPress={() =>
            openShare({
              target: { kind: 'playlist', name: p.name, trackIds: shareable },
              title: p.name,
              subtitle: `${shareable.length} ${shareable.length === 1 ? 'song' : 'songs'}`,
              artworkUri: p.artworkUris[0] ?? null,
            })
          }
        />
      ) : null}
      <SheetAction
        icon="pencil-outline"
        label="Rename"
        keepOpen
        onPress={() =>
          showSheet(
            <PromptSheet
              title="Rename playlist"
              initialValue={p.name}
              onSubmit={(name) => void attempt(renamePlaylist(p.id, name), 'Playlist renamed')}
            />,
          )
        }
      />
      <SheetAction
        icon="trash-outline"
        label="Delete playlist"
        destructive
        onPress={() =>
          confirm({
            title: 'Delete playlist?',
            message: `“${p.name}” will be deleted. Its songs stay in your library.`,
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: async () => {
              const ok = await attempt(
                deletePlaylist(p.id).then(() => true),
                'Playlist deleted',
              );
              if (ok) opts.onDeleted?.();
            },
          })
        }
      />
    </View>,
    { anchor: opts.anchor },
  );
}
