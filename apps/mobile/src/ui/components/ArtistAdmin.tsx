/**
 * Admin sheets for server artists and tracks: merge two artists into one (picking the name shown), rename,
 * unmerge, and edit a track's title/artist/album. Everything is stored on the server; files keep their tags.
 */
import { useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

import {
  editTrackInfo,
  mergeArtists,
  renameArtist,
  unmergeArtist,
  useArtistSearch,
  type AppTrack,
  type ArtistView,
  type TrackEdit,
} from '@/core';

import { attempt } from '../actions';
import { haptics } from '../haptics';
import { closeSheet, showSheet } from '../overlay';
import { makeStyles, radius, space, useColors } from '../theme';
import { SheetAction, SheetHeader, SheetScrollView } from './ActionSheet';
import { Artwork } from './Artwork';
import { confirm } from './ConfirmSheet';
import { Icon } from './Icon';
import { ListRow } from './ListRow';
import { PressableScale } from './PressableScale';
import { PrimaryButton } from './PrimaryButton';
import { PromptSheet } from './PromptSheet';
import { Text } from './Text';

const tracksLabel = (n: number) => `${n} ${n === 1 ? 'track' : 'tracks'}`;

/** Admin actions for a server artist (artist page "…"). */
export function openArtistAdmin(artist: ArtistView) {
  showSheet(<ArtistAdminSheet artist={artist} />);
}

function ArtistAdminSheet({ artist }: { artist: ArtistView }) {
  const aliases = artist.aliases ?? [];
  return (
    <View>
      <SheetHeader
        title={artist.name}
        subtitle={aliases.length ? `Also shown for: ${aliases.join(', ')}` : tracksLabel(artist.trackCount)}
        artworkUri={artist.artworkUri}
        artworkLabel={artist.name}
      />
      <SheetAction
        icon="person-outline"
        label="Merge with another artist…"
        keepOpen
        onPress={() => showSheet(<MergePicker artist={artist} />)}
      />
      <SheetAction
        icon="pencil-outline"
        label="Rename"
        keepOpen
        onPress={() =>
          showSheet(
            <PromptSheet
              title="Rename artist"
              initialValue={artist.name}
              placeholder="Artist name"
              onSubmit={(name) => {
                if (name !== artist.name) void attempt(renameArtist(artist.id, name), `Renamed to ${name}`);
              }}
            />,
          )
        }
      />
      {artist.merged ? (
        <SheetAction
          icon="remove-circle-outline"
          label="Undo merges"
          destructive
          onPress={() =>
            confirm({
              title: 'Undo merges?',
              message: `${aliases.length ? aliases.join(', ') : 'The merged artists'} will be separate artists again.`,
              confirmLabel: 'Undo',
              destructive: true,
              onConfirm: () => void attempt(unmergeArtist(artist.id), 'Merges undone'),
            })
          }
        />
      ) : null}
    </View>
  );
}

/** Pick the artist to merge with. */
function MergePicker({ artist }: { artist: ArtistView }) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const { artists, isLoading } = useArtistSearch(query);
  const others = artists.filter((a) => a.id !== artist.id);
  return (
    <View style={styles.picker}>
      <View style={styles.pad}>
        <Text variant="heading">Merge “{artist.name}” with…</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search artists"
          placeholderTextColor={colors.textTertiary}
          autoFocus={Platform.OS === 'web'}
          autoCorrect={false}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          style={styles.input}
        />
      </View>
      <SheetScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {others.map((a) => (
          <ListRow
            key={a.id}
            leading={<Artwork uri={a.artworkUri} label={a.name} size={44} round />}
            title={a.name}
            subtitle={[tracksLabel(a.trackCount), ...(a.aliases?.length ? [a.aliases.join(', ')] : [])].join(' · ')}
            onPress={() => openMergeName(artist, a)}
          />
        ))}
        {!others.length ? (
          <Text variant="caption" style={styles.pad}>
            {isLoading ? 'Searching…' : 'No other artists found'}
          </Text>
        ) : null}
      </SheetScrollView>
    </View>
  );
}

/** Asks which name the merged artist is shown as, then merges. */
export function openMergeName(a: ArtistView, b: ArtistView) {
  showSheet(<MergeNameSheet a={a} b={b} />);
}

function MergeNameSheet({ a, b }: { a: ArtistView; b: ArtistView }) {
  const styles = useStyles();
  const colors = useColors();
  // The bigger artist keeps its page (and its name is the default).
  const [keep, other] = b.trackCount > a.trackCount ? [b, a] : [a, b];
  const names = [...new Set([keep.name, other.name, ...(keep.aliases ?? []), ...(other.aliases ?? [])])];
  const [name, setName] = useState(keep.name);
  const merge = () => {
    closeSheet();
    haptics.success();
    void attempt(mergeArtists([keep.id, other.id], name), `Merged as ${name}`);
  };
  return (
    <View style={[styles.pad, styles.gap]}>
      <View style={styles.copy}>
        <Text variant="heading">Show them as</Text>
        <Text variant="caption">
          {tracksLabel(keep.trackCount + other.trackCount)} by “{keep.name}” and “{other.name}” appear under one artist. Your files
          are not changed, and you can undo it from the artist page.
        </Text>
      </View>
      <View>
        {names.map((n) => (
          <PressableScale key={n} onPress={() => setName(n)} accessibilityLabel={`Show as ${n}`} style={styles.option}>
            <Icon name={n === name ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={n === name ? colors.accent : colors.textTertiary} />
            <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {n}
            </Text>
          </PressableScale>
        ))}
      </View>
      <View style={styles.buttons}>
        <PrimaryButton label="Cancel" variant="surface" onPress={closeSheet} style={styles.flex} />
        <PrimaryButton label="Merge" onPress={merge} style={styles.flex} />
      </View>
    </View>
  );
}

/** Admin: edit a server track's title / artist / album. */
export function openEditTrack(track: AppTrack) {
  showSheet(<EditTrackSheet track={track} />);
}

function EditTrackSheet({ track }: { track: AppTrack }) {
  const styles = useStyles();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const edit: TrackEdit = {};
  if (title.trim() !== track.title) edit.title = title.trim();
  if (artist.trim() !== track.artist) edit.artist = artist.trim();
  if (album.trim() !== track.album) edit.album = album.trim();
  const dirty = Object.keys(edit).length > 0;
  const valid = !!title.trim() && !!artist.trim() && !!album.trim();
  const save = () => {
    if (!dirty || !valid) return;
    closeSheet();
    void attempt(editTrackInfo(track, edit), 'Saved');
  };
  return (
    <View style={[styles.pad, styles.gap]}>
      <View style={styles.copy}>
        <Text variant="heading">Edit info</Text>
        <Text variant="caption">Saved on the server for everyone; the file keeps its tags. Separate artists with “, ”.</Text>
      </View>
      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Artist" value={artist} onChange={setArtist} />
      <Field label="Album" value={album} onChange={setAlbum} onSubmit={save} />
      <View style={styles.buttons}>
        <PrimaryButton label="Cancel" variant="surface" onPress={closeSheet} style={styles.flex} />
        <PrimaryButton label="Save" onPress={save} disabled={!dirty || !valid} style={styles.flex} />
      </View>
      {track.edited ? (
        <PrimaryButton
          label="Restore the file's tags"
          icon="refresh"
          variant="surface"
          onPress={() => {
            closeSheet();
            void attempt(editTrackInfo(track, { title: null, artist: null, album: null }), 'Restored');
          }}
        />
      ) : null}
    </View>
  );
}

function Field({ label, value, onChange, onSubmit }: { label: string; value: string; onChange: (v: string) => void; onSubmit?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text variant="micro">{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={colors.textTertiary}
        maxLength={500}
        returnKeyType={onSubmit ? 'done' : 'next'}
        onSubmitEditing={onSubmit}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        style={styles.input}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pad: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md, gap: space.md },
  gap: { gap: space.lg },
  copy: { gap: space.xs },
  picker: { maxHeight: 560 },
  list: { flexGrow: 0 },
  field: { gap: space.xs },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: Platform.OS === 'web' ? 16 : 15,
    fontWeight: '500',
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  buttons: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
}));
