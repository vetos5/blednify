import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  player,
  useLikedTracks,
  useLocalAlbums,
  useLocalTracks,
  useRecentlyPlayed,
  useRemoteAlbums,
  useRemoteTracks,
  useServerStatus,
  type AlbumView,
  type AppTrack,
  fileStorageSupported,
} from '@/core';
import { importMusic } from '@/ui/actions';
import { Backdrop } from '@/ui/components/Backdrop';
import { AlbumCard } from '@/ui/components/AlbumCard';
import { Artwork } from '@/ui/components/Artwork';
import { EmptyState } from '@/ui/components/EmptyState';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { PressableScale } from '@/ui/components/PressableScale';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { Rail, useRailCardWidth } from '@/ui/components/Rail';
import { Text } from '@/ui/components/Text';
import { openTrackActions } from '@/ui/components/TrackActions';
import { contextMenu } from '@/ui/desktop/web';
import { haptics } from '@/ui/haptics';
import { nav } from '@/ui/nav';
import type { SheetAnchor } from '@/ui/overlay';
import { useChromeInset , useGlassSurface } from '@/ui/chrome';
import { useGutter, useIsWide } from '@/ui/layout';
import { makeStyles, radius, space, useColors } from '@/ui/theme';
import { spokenLabel } from '@/ui/a11y';

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const albumKey = (a: AlbumView) => `${a.origin}:${a.id}`;
const trackKey = (t: AppTrack) => t.key;

/** Distinct albums of recently played tracks, most recent first; the track supplies art and ids. */
function recentAlbumsOf(tracks: readonly AppTrack[]): { key: string; track: AppTrack }[] {
  const seen = new Set<string>();
  const out: { key: string; track: AppTrack }[] = [];
  for (const t of tracks) {
    if (!t.album || !t.albumId) continue;
    const key = `${t.origin}:${t.albumId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, track: t });
  }
  return out;
}

export default function HomeScreen() {
  const styles = useStyles();
  const glass = useGlassSurface();
  const chromeInset = useChromeInset('tabs');
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const gutter = useGutter();
  const cardW = useRailCardWidth();
  const server = useServerStatus();
  const recent = useRecentlyPlayed(20);
  // The grid already lists recent tracks; the rail shows the albums they came from.
  const recentAlbums = useMemo(() => recentAlbumsOf(recent), [recent]);
  const liked = useLikedTracks();
  const localTracks = useLocalTracks();
  const localAlbums = useLocalAlbums();
  const newOnServer = useRemoteTracks({ sort: 'added' });
  const remoteAlbums = useRemoteAlbums();
  const [refreshing, setRefreshing] = useState(false);

  const fresh = newOnServer.tracks.slice(0, 20);
  const albums = remoteAlbums.albums.slice(0, 20);
  const hasServer = server.serverUrl.length > 0;
  const hasLibrary = localTracks.length > 0 || recent.length > 0 || liked.length > 0;
  const showWelcome = !hasServer && !hasLibrary;
  const showOffline = hasServer && !server.isLoading && !server.online && fresh.length === 0;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    newOnServer.refetch();
    remoteAlbums.refetch();
    // Queries are stale-while-revalidate; the spinner is only a gesture acknowledgement.
    setTimeout(() => setRefreshing(false), 700);
  }, [newOnServer, remoteAlbums]);

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingTop: insets.top + (wide ? space.xxl : space.md), paddingBottom: space.xxl + chromeInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          hasServer ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface2}
            />
          ) : undefined
        }>
        <View style={[styles.header, { paddingLeft: gutter, paddingRight: wide ? gutter : space.sm }]}>
          <View style={styles.headerText}>
            <Text variant="display" numberOfLines={1} adjustsFontSizeToFit>
              {greeting()}
            </Text>
            <ServerPill
              online={server.online}
              needsToken={server.needsToken}
              loading={server.isLoading}
              hasServer={hasServer}
              trackCount={server.trackCount}
            />
          </View>
          {fileStorageSupported ? <IconButton icon="arrow-down-circle-outline" label="Downloads" onPress={nav.downloads} /> : null}
          {/* The wide layout's sidebar has Settings. */}
          {wide ? null : <IconButton icon="settings-outline" label="Settings" onPress={nav.settings} />}
        </View>

        {showWelcome ? (
          <EmptyState
            icon="musical-notes"
            title="Your music, nothing else"
            message={
              fileStorageSupported
                ? 'Connect your Blednify server to stream your collection, or import audio files already on this phone.'
                : 'Connect your Blednify server to stream your collection.'
            }>
            <PrimaryButton label="Connect server" icon="server-outline" onPress={nav.settings} />
            {fileStorageSupported ? <PrimaryButton label="Import music" icon="add" variant="surface" onPress={importMusic} /> : null}
          </EmptyState>
        ) : (
          <>
            <QuickGrid recent={recent} likedCount={liked.length} />

            {showOffline ? (
              <View style={[styles.notice, glass, { marginHorizontal: gutter }]}>
                <Icon name="cloud-offline-outline" size={22} color={colors.textSecondary} />
                <View style={styles.noticeText}>
                  <Text variant="bodyStrong">Server unreachable</Text>
                  <Text variant="caption">
                    {fileStorageSupported ? 'Playing from your phone. Check the address in Settings.' : 'Check the server address in Settings.'}
                  </Text>
                </View>
                <IconButton icon="chevron-forward" label="Open settings" onPress={nav.settings} />
              </View>
            ) : null}

            {recentAlbums.length > 0 ? (
              <Rail
                title="Jump back in"
                data={recentAlbums}
                keyExtractor={(a) => a.key}
                renderItem={({ item }) => (
                  <AlbumCard
                    width={cardW}
                    title={item.track.album}
                    subtitle={item.track.artist}
                    artworkUri={item.track.artworkUri}
                    recyclingKey={item.key}
                    onPress={() => nav.album(item.track.albumId, item.track.origin)}
                  />
                )}
                actionLabel="See all"
                onAction={() => nav.library('recents')}
              />
            ) : null}

            <Rail
              title="New on server"
              data={fresh}
              keyExtractor={trackKey}
              renderItem={({ item, index }) => (
                <AlbumCard
                  width={cardW}
                  title={item.title}
                  subtitle={item.artist}
                  artworkUri={item.artworkUri}
                  recyclingKey={item.key}
                  onPress={() => {
                    haptics.tap();
                    player.playTracks(fresh, index);
                  }}
                  onLongPress={(anchor) => openTrackActions(item, { anchor })}
                />
              )}
            />
            <Rail
              title="Albums"
              data={albums}
              keyExtractor={albumKey}
              renderItem={({ item }) => (
                <AlbumCard
                  width={cardW}
                  title={item.title}
                  subtitle={item.artist}
                  artworkUri={item.artworkUri}
                  recyclingKey={albumKey(item)}
                  onPress={() => nav.album(item.id, item.origin)}
                />
              )}
              actionLabel="See all"
              onAction={() => nav.library('albums')}
            />
            <Rail
              title="On this phone"
              data={localAlbums}
              keyExtractor={albumKey}
              renderItem={({ item }) => (
                <AlbumCard
                  width={cardW}
                  title={item.title}
                  subtitle={item.artist}
                  artworkUri={item.artworkUri}
                  recyclingKey={albumKey(item)}
                  onPress={() => nav.album(item.id, item.origin)}
                />
              )}
              actionLabel={fileStorageSupported ? 'Import' : undefined}
              onAction={fileStorageSupported ? importMusic : undefined}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ServerPill({
  online,
  needsToken,
  loading,
  hasServer,
  trackCount,
}: {
  online: boolean;
  needsToken: boolean;
  loading: boolean;
  hasServer: boolean;
  trackCount: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  if (!hasServer) return <Text variant="caption">Local library</Text>;
  const label = loading ? 'Connecting…' : online ? `Server · ${trackCount.toLocaleString()} songs` : needsToken ? 'Server needs a token' : 'Server offline';
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: online ? colors.success : loading ? colors.textTertiary : colors.danger }]} />
      <Text variant="caption">{label}</Text>
    </View>
  );
}

/** Two-column quick-access tiles: Liked songs + recently played (up to 4 rows = 8 tiles). */
function QuickGrid({ recent, likedCount }: { recent: AppTrack[]; likedCount: number }) {
  const styles = useStyles();
  const wide = useIsWide();
  const gutter = useGutter();
  const hasLiked = likedCount > 0;
  const gridRecents = recent.slice(0, hasLiked ? 7 : 8);
  if (gridRecents.length === 0 && !hasLiked) return null;
  return (
    <View style={[styles.grid, { paddingHorizontal: gutter }, wide && styles.gridWide]}>
      {hasLiked ? (
        <QuickTile
          title="Liked songs"
          subtitle={`${likedCount} ${likedCount === 1 ? 'track' : 'tracks'}`}
          wide={wide}
          art={<Artwork uri={null} label="Liked" size={wide ? 64 : 56} radius={0} fallbackIcon="heart" />}
          onPress={() => nav.library('liked')}
        />
      ) : null}
      {gridRecents.map((t, i) => (
        <QuickTile
          key={t.key}
          title={t.title}
          subtitle={t.artist}
          wide={wide}
          art={<Artwork uri={t.artworkUri} label={t.album || t.title} size={wide ? 64 : 56} radius={0} recyclingKey={t.key} />}
          onPress={() => {
            haptics.tap();
            player.playTracks(recent, i);
          }}
          onLongPress={(anchor) => openTrackActions(t, { anchor })}
        />
      ))}
    </View>
  );
}

function QuickTile({
  title,
  subtitle,
  art,
  wide,
  onPress,
  onLongPress,
}: {
  wide: boolean;
  title: string;
  subtitle: string;
  art: ReactNode;
  onPress: () => void;
  onLongPress?: (anchor?: SheetAnchor) => void;
}) {
  const styles = useStyles();
  const glass = useGlassSurface();
  const [hovered, setHovered] = useState(false);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={spokenLabel(title)}
      onPress={onPress}
      onLongPress={onLongPress ? () => onLongPress() : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...contextMenu(onLongPress)}
      style={[styles.tile, glass, wide && styles.tileWide, hovered && styles.tileHover]}>
      {art}
      <View style={styles.tileText}>
        <Text variant="bodyStrong" numberOfLines={1} style={styles.tileTitle}>
          {title}
        </Text>
        <Text variant="caption" numberOfLines={1} style={styles.tileSub}>
          {subtitle}
        </Text>
      </View>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xl },
  headerText: { flex: 1, gap: space.xs },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xxl },
  tile: {
    width: '48.6%',
    flexGrow: 1,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  gridWide: { gap: space.md },
  tileWide: { width: '23.5%', flexGrow: 0, height: 64 },
  tileHover: { backgroundColor: colors.surface3 },
  tileText: { flex: 1, minWidth: 0, paddingHorizontal: space.sm + 2 },
  tileTitle: { fontSize: 13, lineHeight: 17 },
  tileSub: { fontSize: 11, lineHeight: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.xxl,
    padding: space.md,
    paddingLeft: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  noticeText: { flex: 1, gap: 2 },
}));
