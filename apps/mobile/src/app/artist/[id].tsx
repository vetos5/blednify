import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { player, useArtist, useSettings, type AlbumView, type AppTrack } from '@/core';
import { Backdrop } from '@/ui/components/Backdrop';
import { AlbumCard } from '@/ui/components/AlbumCard';
import { openArtistAdmin } from '@/ui/components/ArtistAdmin';
import { Artwork } from '@/ui/components/Artwork';
import { DetailHeader } from '@/ui/components/DetailHeader';
import { EmptyState } from '@/ui/components/EmptyState';
import { IconButton } from '@/ui/components/IconButton';
import { Loading } from '@/ui/components/Loading';
import { ChromeHost, useChromeInset } from '@/ui/chrome';
import { DockedMiniPlayer } from '@/ui/components/MiniPlayer';
import { OpenInApp } from '@/ui/components/OpenInApp';
import { openShare } from '@/ui/components/ShareSheet';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { Rail, useRailCardWidth } from '@/ui/components/Rail';
import { FloatingBack } from '@/ui/components/ScreenHeader';
import { SectionHeader } from '@/ui/components/SectionHeader';
import { openTrackActions } from '@/ui/components/TrackActions';
import { TrackRow } from '@/ui/components/TrackRow';
import { plural } from '@/ui/format';
import { haptics } from '@/ui/haptics';
import { nav, parseOrigin } from '@/ui/nav';
import type { SheetAnchor } from '@/ui/overlay';
import { makeStyles, space } from '@/ui/theme';

const onMore = (track: AppTrack, _i: number, anchor?: SheetAnchor) => openTrackActions(track, { hideArtist: true, anchor });
const albumKey = (a: AlbumView) => `${a.origin}:${a.id}`;

export default function ArtistScreen() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ id: string; origin?: string }>();
  const origin = parseOrigin(params.origin);
  const insets = useSafeAreaInsets();
  const chromeInset = useChromeInset('detail');
  const cardW = useRailCardWidth();
  const { artist, albums, tracks, isLoading } = useArtist(params.id, origin);
  const { adminMode, adminToken } = useSettings();
  const admin = adminMode && !!adminToken;

  if (!artist) {
    return (
      <View style={styles.root}>
        <Backdrop />
        {isLoading ? (
          <Loading />
        ) : (
          <View style={[styles.root, styles.center]}>
            <EmptyState icon="person-outline" title="Artist not found" message="It may have been removed from the server or this device.">
              <PrimaryButton label="Go back" variant="surface" onPress={() => router.back()} />
            </EmptyState>
          </View>
        )}
        <FloatingBack />
      </View>
    );
  }

  const play = (index: number) => {
    haptics.tap();
    player.playTracks(tracks, index);
  };
  const backdrop = artist.artworkUri ?? albums.find((a) => a.artworkUri)?.artworkUri ?? null;

  return (
    <ChromeHost overlay={<DockedMiniPlayer />}>
      <Backdrop />
      <FlashList
        data={tracks}
        keyExtractor={(t) => t.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl + chromeInset }}
        ListHeaderComponent={
          <>
            <DetailHeader
              renderArtwork={(size) => <Artwork uri={backdrop} label={artist.name} size={size} round priority="high" />}
              backdropUri={backdrop}
              eyebrow="Artist"
              title={artist.name}
              meta={[plural(artist.albumCount || albums.length, 'album'), plural(artist.trackCount || tracks.length, 'track')].join(' · ')}
              onPlay={tracks.length ? () => player.playTracks(tracks, 0) : undefined}
              onShuffle={tracks.length ? () => player.playTracks(tracks, undefined, { shuffle: true }) : undefined}
              actions={
                artist.origin === 'remote' ? (
                  <>
                    <IconButton
                      icon="share-outline"
                      label="Share artist"
                      variant="filled"
                      onPress={() =>
                        openShare({ target: { kind: 'artist', id: artist.id }, title: artist.name, subtitle: 'Artist', artworkUri: backdrop })
                      }
                    />
                    {admin ? (
                      <IconButton icon="ellipsis-horizontal" label="Artist options" variant="filled" onPress={() => openArtistAdmin(artist)} />
                    ) : null}
                  </>
                ) : undefined
              }
            />
            <Rail
              title="Albums"
              data={albums}
              keyExtractor={albumKey}
              renderItem={({ item }) => (
                <AlbumCard
                  width={cardW}
                  title={item.title}
                  subtitle={item.year ? String(item.year) : `${item.trackCount} tracks`}
                  artworkUri={item.artworkUri}
                  recyclingKey={albumKey(item)}
                  onPress={() => nav.album(item.id, item.origin)}
                />
              )}
            />
            {tracks.length > 0 ? <SectionHeader title="Songs" /> : null}
          </>
        }
        ListEmptyComponent={isLoading ? <Loading /> : null}
        renderItem={({ item, index }) => <TrackRow track={item} index={index} onPress={play} onMore={onMore} />}
      />
      <FloatingBack />
      {artist.origin === 'remote' ? <OpenInApp path={`/artist/${params.id}`} /> : null}
    </ChromeHost>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center' },
}));
