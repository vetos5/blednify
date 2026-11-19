import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  player,
  useAllRemoteTracks,
  useLikedTracks,
  useLocalAlbums,
  useLocalArtists,
  useLocalTracks,
  usePlaylists,
  useRecentlyPlayed,
  useRemoteAlbums,
  useRemoteArtists,
  useServerBase,
  useSettings,
  type AlbumView,
  type AppTrack,
  type ArtistView,
  fileStorageSupported,
} from '@/core';
import { importMusic } from '@/ui/actions';
import { Backdrop } from '@/ui/components/Backdrop';
import { AlbumCard } from '@/ui/components/AlbumCard';
import { Chip } from '@/ui/components/Chip';
import { EmptyState } from '@/ui/components/EmptyState';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { ListRow } from '@/ui/components/ListRow';
import { Loading } from '@/ui/components/Loading';
import { PlaylistArtwork } from '@/ui/components/PlaylistArtwork';
import { openPlaylistActions, promptNewPlaylist } from '@/ui/components/PlaylistActions';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { Text } from '@/ui/components/Text';
import { onTrackMore } from '@/ui/components/TrackActions';
import { TrackRow, TrackTableHeader } from '@/ui/components/TrackRow';
import { haptics } from '@/ui/haptics';
import { nav, type LibraryFilter } from '@/ui/nav';
import { useChromeInset } from '@/ui/chrome';
import { useGutter, useIsWide } from '@/ui/layout';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const FILTERS: { key: LibraryFilter; label: string }[] = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'recents', label: 'Recents' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'songs', label: 'Songs' },
  { key: 'liked', label: 'Liked' },
  ...(fileStorageSupported
    ? ([
        { key: 'downloaded', label: 'Downloaded' },
        { key: 'device', label: 'On this device' },
      ] as const)
    : []),
];

function isFilter(v: unknown): v is LibraryFilter {
  return FILTERS.some((f) => f.key === v);
}

export default function LibraryScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  // The route param is the single source of truth, so shortcuts (Home → Liked) always win over a stale chip.
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: LibraryFilter = isFilter(params.filter) ? params.filter : 'playlists';
  const wide = useIsWide();
  const gutter = useGutter();

  return (
    <View style={[styles.root, { paddingTop: insets.top + (wide ? space.xxl : space.md) }]}>
      <Backdrop />
      <View style={[styles.header, { paddingLeft: gutter, paddingRight: wide ? gutter : space.sm }]}>
        <Text variant="display" style={styles.flex}>
          Library
        </Text>
        <IconButton icon="add" label="New playlist" size={26} onPress={promptNewPlaylist} />
        {fileStorageSupported ? <IconButton icon="folder-open-outline" label="Import music from device" onPress={importMusic} /> : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={[styles.chips, { paddingHorizontal: gutter }]}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => router.setParams({ filter: f.key })} />
        ))}
      </ScrollView>
      {filter === 'playlists' ? <PlaylistsList /> : null}
      {filter === 'recents' ? <RecentsList /> : null}
      {filter === 'albums' ? <AlbumsGrid /> : null}
      {filter === 'artists' ? <ArtistsGrid /> : null}
      {filter === 'songs' ? <SongsList /> : null}
      {filter === 'liked' ? <LikedList /> : null}
      {filter === 'downloaded' ? <DownloadedList /> : null}
      {filter === 'device' ? <DeviceList /> : null}
    </View>
  );
}

function PlaylistsList() {
  const styles = useStyles();
  const chromeInset = useChromeInset('tabs');
  const colors = useColors();
  const playlists = usePlaylists();
  const { adminMode, adminToken } = useSettings();
  const admin = adminMode && !!adminToken;
  return (
    <FlashList
      data={playlists}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ paddingBottom: space.xl + chromeInset }}
      ListHeaderComponent={
        <>
          <ListRow
            leading={
              <View style={styles.newTile}>
                <Icon name="add" size={28} color={colors.accent} />
              </View>
            }
            title="New playlist"
            onPress={promptNewPlaylist}
          />
          {admin ? (
            <ListRow
              leading={
                <View style={styles.newTile}>
                  <Icon name="playlist-import" size={26} color={colors.accent} />
                </View>
              }
              title="Import playlist"
              subtitle="From a Spotify, SoundCloud or YouTube link"
              onPress={nav.importPlaylist}
            />
          ) : null}
        </>
      }
      ListEmptyComponent={<EmptyState icon="list" title="No playlists yet" message="Create one, then long-press any song to add it." />}
      renderItem={({ item }) => (
        <ListRow
          leading={<PlaylistArtwork uris={item.artworkUris} name={item.name} size={56} />}
          title={item.name}
          subtitle={`Playlist · ${item.trackCount} ${item.trackCount === 1 ? 'track' : 'tracks'}`}
          onPress={() => nav.playlist(item.id)}
          onLongPress={() => {
            haptics.press();
            openPlaylistActions(item);
          }}
          onContextMenu={(anchor) => openPlaylistActions(item, { anchor })}
        />
      )}
    />
  );
}

function AlbumsGrid() {
  const styles = useStyles();
  const chromeInset = useChromeInset('tabs');
  const wide = useIsWide();
  // Wide layout: as many ~190px columns as the page column fits.
  const [pageW, setPageW] = useState(0);
  const columns = wide && pageW > 0 ? Math.max(3, Math.floor((pageW - 48) / 190)) : 2;
  const local = useLocalAlbums();
  const { albums: remote, isLoading, isError, refetch } = useRemoteAlbums();
  const seen = new Set<string>();
  const albums: AlbumView[] = [];
  for (const a of [...local, ...remote]) {
    const k = `${a.origin}:${a.id}`;
    if (!seen.has(k)) {
      seen.add(k);
      albums.push(a);
    }
  }
  return (
    // Measured outside the list: its own scrollbar must not change the column count (that looped).
    <View style={styles.flex} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
    <FlashList
      key={columns}
      data={albums}
      numColumns={columns}
      keyExtractor={(a) => `${a.origin}:${a.id}`}
      contentContainerStyle={{ paddingHorizontal: wide ? space.xl : space.md, paddingBottom: space.xl + chromeInset }}
      ListEmptyComponent={
        isLoading ? (
          <Loading />
        ) : isError ? (
          <EmptyState icon="cloud-offline-outline" title="Can’t reach your server" message="Albums from the server show up here once it’s back.">
            <PrimaryButton label="Try again" icon="refresh" variant="surface" onPress={refetch} />
          </EmptyState>
        ) : (
        <EmptyState
          icon="disc-outline"
          title="No albums yet"
          message={fileStorageSupported ? 'Import music or connect your server to see albums here.' : 'Connect your server to see albums here.'}>
          {fileStorageSupported ? <PrimaryButton label="Import music" icon="add" variant="surface" onPress={importMusic} /> : null}
        </EmptyState>
        )
      }
      renderItem={({ item }) => (
        <View style={styles.gridCell}>
          <AlbumCard
            title={item.title}
            subtitle={item.year ? `${item.artist} · ${item.year}` : item.artist}
            artworkUri={item.artworkUri}
            recyclingKey={`${item.origin}:${item.id}`}
            onPress={() => nav.album(item.id, item.origin)}
          />
        </View>
      )}
    />
    </View>
  );
}

function ArtistsGrid() {
  const styles = useStyles();
  const chromeInset = useChromeInset('tabs');
  const wide = useIsWide();
  const [pageW, setPageW] = useState(0);
  const columns = wide && pageW > 0 ? Math.max(3, Math.floor((pageW - 48) / 190)) : 2;
  const local = useLocalArtists();
  const { artists: remote, isLoading, isError, refetch } = useRemoteArtists();
  const artists = useMemo(() => {
    const seen = new Set<string>();
    const out: ArtistView[] = [];
    for (const a of [...remote, ...local]) {
      const k = `${a.origin}:${a.id}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [remote, local]);
  return (
    <View style={styles.flex} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
      <FlashList
        key={columns}
        data={artists}
        numColumns={columns}
        keyExtractor={(a) => `${a.origin}:${a.id}`}
        contentContainerStyle={{ paddingHorizontal: wide ? space.xl : space.md, paddingBottom: space.xl + chromeInset }}
        ListEmptyComponent={
          isLoading ? (
            <Loading />
          ) : isError ? (
            <EmptyState icon="cloud-offline-outline" title="Can’t reach your server" message="Artists from the server show up here once it’s back.">
              <PrimaryButton label="Try again" icon="refresh" variant="surface" onPress={refetch} />
            </EmptyState>
          ) : (
            <EmptyState
              icon="person-outline"
              title="No artists yet"
              message={fileStorageSupported ? 'Import music or connect your server to see artists here.' : 'Connect your server to see artists here.'}
            />
          )
        }
        renderItem={({ item }) => (
          <View style={styles.gridCell}>
            <AlbumCard
              title={item.name}
              subtitle={`${item.trackCount} ${item.trackCount === 1 ? 'song' : 'songs'}`}
              artworkUri={item.artworkUri}
              round
              recyclingKey={`${item.origin}:${item.id}`}
              onPress={() => nav.artist(item.id, item.origin)}
            />
          </View>
        )}
      />
    </View>
  );
}

function RecentsList() {
  const tracks = useRecentlyPlayed(50);
  return (
    <TrackList
      tracks={tracks}
      empty={<EmptyState icon="time-outline" title="No recently played songs" message="Tracks you play will appear here." />}
    />
  );
}

function SongsList() {
  const hasServer = !!useServerBase();
  const { tracks, isLoading, isError, refetch } = useAllRemoteTracks();
  if (isLoading) return <Loading />;
  return (
    <TrackList
      tracks={tracks}
      empty={
        !hasServer ? (
          <EmptyState icon="cloud-offline-outline" title="No server connected" message="Connect your server in Settings to browse its songs.">
            <PrimaryButton label="Open Settings" icon="settings-outline" variant="surface" onPress={nav.settings} />
          </EmptyState>
        ) : isError ? (
          <EmptyState icon="cloud-offline-outline" title="Can’t reach your server" message="Its songs show up here once it’s back.">
            <PrimaryButton label="Try again" icon="refresh" variant="surface" onPress={refetch} />
          </EmptyState>
        ) : (
          <EmptyState icon="musical-notes-outline" title="No songs on the server" message="Add music to the server’s folder, or upload it in Admin mode." />
        )
      }
    />
  );
}

function LikedList() {
  const tracks = useLikedTracks();
  return (
    <TrackList
      tracks={tracks}
      empty={<EmptyState icon="heart-outline" title="Nothing liked yet" message="Tap the heart in the player to save songs here." />}
    />
  );
}

function DownloadedList() {
  const tracks = useLocalTracks().filter((t) => t.origin === 'remote');
  return (
    <TrackList
      tracks={tracks}
      extra={<IconButton icon="settings-outline" label="Manage downloads" variant="filled" onPress={nav.downloads} />}
      empty={
        <EmptyState
          icon="arrow-down-circle-outline"
          title="No downloads"
          message="Download server tracks to listen offline. Long-press a song or use the download button in the player."
        />
      }
    />
  );
}

function DeviceList() {
  const tracks = useLocalTracks().filter((t) => t.origin === 'local');
  return (
    <TrackList
      tracks={tracks}
      extra={<IconButton icon="add" label="Import music" variant="filled" onPress={importMusic} />}
      empty={
        <EmptyState
          icon="phone-portrait-outline"
          title="No music on this device"
          message="Import audio files from your phone. They stay on this phone.">
          <PrimaryButton label="Import music" icon="add" onPress={importMusic} />
        </EmptyState>
      }
    />
  );
}

function TrackList({ tracks, empty, extra }: { tracks: AppTrack[]; empty: ReactElement; extra?: ReactNode }) {
  const styles = useStyles();
  const chromeInset = useChromeInset('tabs');
  const wide = useIsWide();
  const gutter = useGutter();
  const play = (index: number) => {
    haptics.tap();
    player.playTracks(tracks, index);
  };
  return (
    <FlashList
      data={tracks}
      keyExtractor={(t) => t.key}
      contentContainerStyle={{ paddingBottom: space.xl + chromeInset }}
      ListEmptyComponent={empty}
      ListHeaderComponent={
        tracks.length > 0 ? (
          <>
          <View style={[styles.playRow, wide && { paddingHorizontal: gutter }]}>
            <Text variant="caption" style={styles.flex}>
              {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
            </Text>
            {extra}
            <IconButton icon="shuffle" label="Shuffle" variant="filled" haptic onPress={() => player.playTracks(tracks, undefined, { shuffle: true })} />
            <IconButton icon="play" label="Play all" variant="accent" haptic size={22} diameter={48} onPress={() => player.playTracks(tracks, 0)} />
          </View>
          <TrackTableHeader album />
          </>
        ) : null
      }
      renderItem={({ item, index }) => <TrackRow track={item} index={index} onPress={play} onMore={onTrackMore} subtitle="artist-album" />}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  chipsScroll: { flexGrow: 0 },
  chips: { gap: space.sm, paddingBottom: space.md },
  gridCell: { flex: 1, paddingHorizontal: space.xs + 2, paddingBottom: space.lg },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.md, paddingVertical: space.sm },
  newTile: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
}));
