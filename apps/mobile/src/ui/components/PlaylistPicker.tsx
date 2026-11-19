import { View } from 'react-native';

import { addToPlaylist, createPlaylist, usePlaylists, type AppTrack } from '@/core';

import { attempt } from '../actions';
import { haptics } from '../haptics';
import { closeSheet, showSheet } from '../overlay';
import { makeStyles, space, useColors } from '../theme';
import { SheetAction, SheetHeader, SheetScrollView } from './ActionSheet';
import { Icon } from './Icon';
import { ListRow } from './ListRow';
import { PlaylistArtwork } from './PlaylistArtwork';
import { PromptSheet } from './PromptSheet';
import { Text } from './Text';

/** Sheet content: choose (or create) a playlist to add `tracks` to. */
export function PlaylistPicker({ tracks }: { tracks: AppTrack[] }) {
  const styles = useStyles();
  const colors = useColors();
  const playlists = usePlaylists();
  const what = tracks.length === 1 ? tracks[0].title : `${tracks.length} songs`;
  return (
    <View>
      <SheetHeader title="Add to playlist" subtitle={what} />
      <SheetAction
        icon="add-circle-outline"
        label="New playlist"
        keepOpen
        onPress={() =>
          showSheet(
            <PromptSheet
              title="New playlist"
              placeholder="Playlist name"
              submitLabel="Create"
              onSubmit={(name) => void createAndAdd(name, tracks)}
            />,
          )
        }
      />
      {playlists.length > 0 ? (
        <SheetScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {playlists.map((p) => (
            <ListRow
              key={p.id}
              leading={<PlaylistArtwork uris={p.artworkUris} name={p.name} size={44} />}
              title={p.name}
              subtitle={`${p.trackCount} ${p.trackCount === 1 ? 'track' : 'tracks'}`}
              onPress={() => {
                haptics.select();
                closeSheet();
                void attempt(addToPlaylist(p.id, tracks), `Added to ${p.name}`);
              }}
            />
          ))}
        </SheetScrollView>
      ) : (
        <View style={styles.empty}>
          <Icon name="list" size={18} color={colors.textTertiary} />
          <Text variant="caption">No playlists yet — create your first one.</Text>
        </View>
      )}
    </View>
  );
}

async function createAndAdd(name: string, tracks: AppTrack[]) {
  const id = await attempt(createPlaylist(name));
  if (id) await attempt(addToPlaylist(id, tracks), `Added to ${name}`);
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 380 },
  listContent: { paddingBottom: space.sm },
  empty: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.lg },
}));
