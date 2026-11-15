import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { hasLyrics, player, useLyrics, usePlayer, usePrefetchLyrics, type AppTrack } from '@/core';

import { Artwork, ArtworkBackdrop } from '../components/Artwork';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { LikeButton } from '../components/LikeButton';
import { Text } from '../components/Text';
import { openTrackActions } from '../components/TrackActions';
import { nav } from '../nav';
import { makeStyles, radius, space, useColors } from '../theme';
import { LyricsView } from './LyricsView';
import { closeNowPlaying } from './now-playing';
import { Tip } from './Tip';
import { Pressable } from './web';
import { spokenLabel } from '../a11y';

/**
 * Wide layout's Now playing view (the `/player` route): the cover large beside synced lyrics, or beside
 * what's up next when the song has none. Transport stays in the player bar below.
 */
export function DesktopNowPlaying() {
  const styles = useStyles();
  const current = usePlayer((s) => s.current);
  usePrefetchLyrics(usePlayer((s) => s.queue[s.index + 1]));
  return (
    <View style={styles.root}>
      <Backdrop uri={current?.artworkUri ?? null} />
      <View style={styles.top}>
        <Tip label="Close" shortcut="Esc" side="bottom">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close now playing"
            onPress={closeNowPlaying}
            style={({ hovered }) => [styles.close, hovered && styles.closeHover]}>
            <Icon name="chevron-down" size={22} />
          </Pressable>
        </Tip>
      </View>
      {current ? (
        <Stage track={current} />
      ) : (
        <View style={styles.center}>
          <EmptyState icon="musical-notes-outline" title="Nothing playing" message="Pick something from your library to start listening." />
        </View>
      )}
    </View>
  );
}

function Stage({ track }: { track: AppTrack }) {
  const styles = useStyles();
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const { lyrics, isLoading } = useLyrics(track);
  const withLyrics = isLoading || hasLyrics(lyrics);
  const art = Math.round(Math.max(220, Math.min(withLyrics ? 440 : 520, height * 0.5, width * 0.3)));
  const go = (fn: () => void) => {
    closeNowPlaying();
    fn();
  };
  return (
    <View style={styles.stage}>
      <View style={[styles.left, !withLyrics && styles.leftSolo]}>
        <View
          style={[styles.art, { width: art, height: art }]}
          {...({
            onContextMenu: (e: MouseEvent) => {
              e.preventDefault();
              openTrackActions(track, { anchor: { x: e.clientX, y: e.clientY }, beforeNavigate: closeNowPlaying });
            },
          } as object)}>
          <Artwork uri={track.artworkUri} label={track.album || track.title} size={art} radius={radius.lg} recyclingKey={track.key} priority="high" />
        </View>
        <View style={[styles.titles, { width: art }]}>
          <View style={styles.titleRow}>
            <Text variant="title" numberOfLines={2} style={styles.title}>
              {track.title}
            </Text>
            <LikeButton track={track} size={24} />
          </View>
          <LinkLine label={track.artist} onPress={() => go(() => nav.artist(track.artistId, track.origin))} strong />
          {track.album ? <LinkLine label={track.album} onPress={() => go(() => nav.album(track.albumId, track.origin))} /> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => openTrackActions(track, { beforeNavigate: closeNowPlaying })}
            style={({ hovered }) => [styles.more, hovered && styles.closeHover]}>
            <Icon name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
            <Text variant="caption">More</Text>
          </Pressable>
        </View>
      </View>
      {withLyrics ? (
        <View style={styles.right}>
          <LyricsView track={track} size="stage" />
        </View>
      ) : (
        <View style={styles.right}>
          <UpNext />
        </View>
      )}
    </View>
  );
}

function LinkLine({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.link}>
      {({ hovered }) => (
        <Text
          variant={strong ? 'subheading' : 'body'}
          color={hovered ? colors.text : colors.textSecondary}
          numberOfLines={1}
          style={hovered ? styles.underline : undefined}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function UpNext() {
  const styles = useStyles();
  const colors = useColors();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const next = queue.slice(index + 1, index + 9);
  return (
    <View style={styles.upNext}>
      <Text variant="micro" color={colors.textTertiary}>
        UP NEXT
      </Text>
      {next.length === 0 ? (
        <Text variant="body" color={colors.textSecondary}>
          Nothing queued after this song.
        </Text>
      ) : (
        next.map((t, i) => (
          <Pressable
            key={`${index + 1 + i}:${t.key}`}
            accessibilityRole="button"
            accessibilityLabel={spokenLabel(`Play ${t.title} by ${t.artist}`)}
            onPress={() => player.jumpTo(index + 1 + i)}
            style={({ hovered }) => [styles.nextRow, hovered && styles.closeHover]}>
            <Artwork uri={t.artworkUri} label={t.album || t.title} size={48} recyclingKey={t.key} />
            <View style={styles.nextMeta}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {t.title}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {t.artist}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

function Backdrop({ uri }: { uri: string | null }) {
  const colors = useColors();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ArtworkBackdrop uri={uri} blurRadius={90} transition={400} />
      <LinearGradient
        colors={uri ? ['rgba(10,10,12,0.55)', 'rgba(10,10,12,0.8)', 'rgba(10,10,12,0.94)'] : [colors.accentDeep, colors.bg, colors.bg]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  top: { position: 'absolute', top: space.lg, left: space.lg, zIndex: 5 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  closeHover: { backgroundColor: colors.pressed },
  center: { flex: 1, justifyContent: 'center' },
  stage: { flex: 1, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: space.xxxl, gap: space.xxxl },
  left: { justifyContent: 'center', gap: space.xl, paddingVertical: space.xxl },
  leftSolo: { flex: 1, alignItems: 'flex-end' },
  art: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    shadowColor: colors.black,
    shadowOpacity: 0.55,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 24 },
  },
  titles: { gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { flex: 1 },
  link: { alignSelf: 'flex-start', maxWidth: '100%' },
  underline: { textDecorationLine: 'underline' },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.sm,
    marginLeft: -space.sm,
    paddingHorizontal: space.sm,
    height: 32,
    borderRadius: radius.pill,
  },
  right: { flex: 1, minWidth: 0 },
  upNext: { flex: 1, justifyContent: 'center', gap: space.sm, maxWidth: 520 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
  nextMeta: { flex: 1, minWidth: 0, gap: 2 },
}));
