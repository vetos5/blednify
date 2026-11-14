import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToPlaylist, createPlaylist, parseSharedIds, player, useServerBase, useServerTracks, type AppTrack } from '@/core';
import { attempt } from '@/ui/actions';
import { ChromeHost, useChromeInset } from '@/ui/chrome';
import { Backdrop } from '@/ui/components/Backdrop';
import { DetailHeader } from '@/ui/components/DetailHeader';
import { IconButton } from '@/ui/components/IconButton';
import { Loading } from '@/ui/components/Loading';
import { DockedMiniPlayer } from '@/ui/components/MiniPlayer';
import { OpenInApp, SharedNotFound } from '@/ui/components/OpenInApp';
import { PlaylistArtwork } from '@/ui/components/PlaylistArtwork';
import { FloatingBack } from '@/ui/components/ScreenHeader';
import { openShare } from '@/ui/components/ShareSheet';
import { openTrackActions } from '@/ui/components/TrackActions';
import { TrackRow, TrackTableHeader } from '@/ui/components/TrackRow';
import { humanDuration, plural } from '@/ui/format';
import { haptics } from '@/ui/haptics';
import { nav } from '@/ui/nav';
import { type SheetAnchor } from '@/ui/overlay';
import { makeStyles, radius, space } from '@/ui/theme';

const onMore = (track: AppTrack, _i: number, anchor?: SheetAnchor) => openTrackActions(track, { anchor });

/** A playlist someone shared as a link: its server songs, playable here and saveable as your own playlist. */
export default function SharedPlaylistScreen() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ n?: string; t?: string }>();
  const name = (Array.isArray(params.n) ? params.n[0] : params.n)?.trim() || 'Shared playlist';
  const ids = parseSharedIds(params.t);
  const insets = useSafeAreaInsets();
  const chromeInset = useChromeInset('detail');
  const hasServer = !!useServerBase();
  const { tracks, missing, isLoading } = useServerTracks(ids);
  const [saving, setSaving] = useState(false);
  const path = `/shared-playlist?n=${encodeURIComponent(name)}&t=${ids.join('.')}`;

  if (!tracks.length) {
    return (
      <View style={styles.root}>
        <Backdrop />
        {isLoading ? (
          <Loading />
        ) : (
          <View style={[styles.root, styles.center]}>
            <SharedNotFound kind="playlist" hasServer={hasServer} />
          </View>
        )}
        <FloatingBack />
        <OpenInApp path={path} />
      </View>
    );
  }

  const cover = [...new Set(tracks.map((t) => t.artworkUri).filter((u): u is string => !!u))].slice(0, 4);
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const meta = [plural(tracks.length, 'song'), humanDuration(totalMs), missing ? `${missing} no longer on the server` : null]
    .filter(Boolean)
    .join(' · ');
  const play = (index: number) => {
    haptics.tap();
    player.playTracks(tracks, index);
  };
  const save = async () => {
    // A double tap would save the playlist twice.
    if (saving) return;
    setSaving(true);
    const id = await attempt(
      createPlaylist(name).then(async (newId) => {
        await addToPlaylist(newId, tracks);
        return newId;
      }),
      `Saved “${name}” to your playlists`,
    ).finally(() => setSaving(false));
    if (id) nav.playlist(id);
  };

  return (
    <ChromeHost overlay={<DockedMiniPlayer />}>
      <Backdrop />
      <FlashList
        data={tracks}
        keyExtractor={(t, i) => `${i}:${t.key}`}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl + chromeInset }}
        ListHeaderComponent={
          <DetailHeader
            renderArtwork={(size) => <PlaylistArtwork uris={cover} name={name} size={size} radius={radius.lg} />}
            backdropUri={cover[0]}
            eyebrow="Shared playlist"
            title={name}
            meta={meta}
            onPlay={() => play(0)}
            onShuffle={() => player.playTracks(tracks, undefined, { shuffle: true })}
            actions={
              <>
                <IconButton icon="add" label="Save to my playlists" variant="filled" haptic disabled={saving} onPress={() => void save()} />
                <IconButton
                  icon="share-outline"
                  label="Share playlist"
                  variant="filled"
                  onPress={() =>
                    openShare({
                      target: { kind: 'playlist', name, trackIds: tracks.map((t) => t.id) },
                      title: name,
                      subtitle: plural(tracks.length, 'song'),
                      artworkUri: cover[0] ?? null,
                    })
                  }
                />
              </>
            }>
            <TrackTableHeader album />
          </DetailHeader>
        }
        renderItem={({ item, index }) => <TrackRow track={item} index={index} onPress={play} onMore={onMore} subtitle="artist-album" />}
      />
      <FloatingBack />
      <OpenInApp path={path} />
    </ChromeHost>
  );
}

const useStyles = makeStyles(() => ({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
}));
