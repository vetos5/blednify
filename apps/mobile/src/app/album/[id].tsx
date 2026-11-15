import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { downloadTracks, player, useAlbum, type AppTrack, fileStorageSupported } from '@/core';
import { Backdrop } from '@/ui/components/Backdrop';
import { Artwork } from '@/ui/components/Artwork';
import { DetailHeader } from '@/ui/components/DetailHeader';
import { EmptyState } from '@/ui/components/EmptyState';
import { IconButton } from '@/ui/components/IconButton';
import { Loading } from '@/ui/components/Loading';
import { ChromeHost, useChromeInset } from '@/ui/chrome';
import { DockedMiniPlayer } from '@/ui/components/MiniPlayer';
import { OpenInApp } from '@/ui/components/OpenInApp';
import { PlaylistPicker } from '@/ui/components/PlaylistPicker';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { openShare } from '@/ui/components/ShareSheet';
import { FloatingBack } from '@/ui/components/ScreenHeader';
import { openTrackActions } from '@/ui/components/TrackActions';
import { TrackRow, TrackTableHeader } from '@/ui/components/TrackRow';
import { humanDuration, plural } from '@/ui/format';
import { haptics } from '@/ui/haptics';
import { goBack, nav, parseOrigin } from '@/ui/nav';
import { showSheet, showToast, type SheetAnchor } from '@/ui/overlay';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const onMore = (track: AppTrack, _i: number, anchor?: SheetAnchor) => openTrackActions(track, { hideAlbum: true, anchor });

export default function AlbumScreen() {
  const styles = useStyles();
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string; origin?: string }>();
  const origin = parseOrigin(params.origin);
  const insets = useSafeAreaInsets();
  const chromeInset = useChromeInset('detail');
  const { album, tracks, isLoading } = useAlbum(params.id, origin);

  // One tree for every state: the theme backdrop, chrome and back button mount once, so the album
  // arriving (often mid-transition on a first visit) only adds the list instead of rebuilding the screen.
  let body;
  if (album) {
    const play = (index: number) => {
      haptics.tap();
      player.playTracks(tracks, index);
    };
    const remoteMissing = tracks.filter((t) => t.origin === 'remote' && !t.localUri);
    const meta = [album.year, plural(album.trackCount || tracks.length, 'track'), album.durationMs > 0 ? humanDuration(album.durationMs) : null]
      .filter(Boolean)
      .join(' · ');
    body = (
      <FlashList
        data={tracks}
        keyExtractor={(t) => t.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl + chromeInset }}
        ListHeaderComponent={
          <DetailHeader
            renderArtwork={(size) => <Artwork uri={album.artworkUri} label={album.title} size={size} radius={radius.lg} priority="high" />}
            backdropUri={album.artworkUri}
            eyebrow={origin === 'local' ? 'Album · On this device' : 'Album'}
            title={album.title}
            subtitle={album.artist}
            onSubtitlePress={() => nav.artist(album.artistId, album.origin)}
            meta={meta}
            onPlay={tracks.length ? () => player.playTracks(tracks, 0) : undefined}
            onShuffle={tracks.length ? () => player.playTracks(tracks, undefined, { shuffle: true }) : undefined}
            actions={
              <>
                {fileStorageSupported && remoteMissing.length > 0 ? (
                  <IconButton
                    icon="arrow-down-circle-outline"
                    label="Download album"
                    variant="filled"
                    haptic
                    onPress={() => {
                      downloadTracks(remoteMissing);
                      showToast(`Downloading ${plural(remoteMissing.length, 'track')}`);
                    }}
                  />
                ) : null}
                <IconButton
                  icon="add"
                  label="Add album to playlist"
                  variant="filled"
                  disabled={!tracks.length}
                  onPress={() => showSheet(<PlaylistPicker tracks={tracks} />)}
                />
                {origin === 'remote' ? (
                  <IconButton
                    icon="share-outline"
                    label="Share album"
                    variant="filled"
                    onPress={() =>
                      openShare({ target: { kind: 'album', id: album.id }, title: album.title, subtitle: album.artist, artworkUri: album.artworkUri })
                    }
                  />
                ) : null}
              </>
            }>
            {tracks.length ? <TrackTableHeader /> : null}
          </DetailHeader>
        }
        ListEmptyComponent={isLoading ? <View style={styles.listLoading}><ActivityIndicator color={colors.accent} /></View> : null}
        renderItem={({ item, index }) => <TrackRow track={item} index={index} onPress={play} onMore={onMore} leading="number" showDuration />}
      />
    );
  } else if (isLoading) {
    body = <Loading />;
  } else {
    body = (
      <View style={[styles.fill, styles.center]}>
        <EmptyState icon="disc-outline" title="Album not found" message="It may have been removed from the server or this device.">
          <PrimaryButton label="Go back" variant="surface" onPress={goBack} />
        </EmptyState>
      </View>
    );
  }

  return (
    <ChromeHost overlay={<DockedMiniPlayer />}>
      <Backdrop />
      {body}
      <FloatingBack />
      {origin === 'remote' && album ? <OpenInApp path={`/album/${params.id}`} /> : null}
    </ChromeHost>
  );
}

const useStyles = makeStyles(() => ({
  fill: { flex: 1 },
  center: { justifyContent: 'center' },
  listLoading: { paddingVertical: space.xxxl, alignItems: 'center' },
}));
