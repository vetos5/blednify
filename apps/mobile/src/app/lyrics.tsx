import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  hasLyrics,
  player,
  useActiveLyric,
  useLyrics,
  usePlayButton,
  usePlayer,
  usePrefetchLyrics,
  type AppTrack,
  type LyricLine,
  type Lyrics,
} from '@/core';
import { ArtworkBackdrop } from '@/ui/components/Artwork';
import { BusyRing } from '@/ui/components/BusyRing';
import { EmptyState } from '@/ui/components/EmptyState';
import { ImmersiveStatusBar } from '@/ui/components/ImmersiveStatusBar';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { PressableScale } from '@/ui/components/PressableScale';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { SeekBar } from '@/ui/components/SeekBar';
import { Text } from '@/ui/components/Text';
import { useWideRedirect } from '@/ui/desktop/redirect';
import { haptics } from '@/ui/haptics';
import { goBack } from '@/ui/nav';
import { ForceDark, gradientFor, makeStyles, radius, space, useColors } from '@/ui/theme';

/** After the user scrolls by hand, wait this long before following the song again. */
const USER_SCROLL_HOLD_MS = 3500;

const close = goBack;

/** Immersive screen over artwork: stays dark in light themes. */
export default function LyricsScreen() {
  if (useWideRedirect('lyrics')) return null;
  return (
    <ForceDark>
      <ImmersiveStatusBar />
      <LyricsScreenContent />
    </ForceDark>
  );
}

function LyricsScreenContent() {
  const styles = useStyles();
  const colors = useColors();
  const current = usePlayer((s) => s.current);
  const { lyrics, isLoading, isError, refetch } = useLyrics(current);
  usePrefetchLyrics(usePlayer((s) => s.queue[s.index + 1]));
  const insets = useSafeAreaInsets();
  const [tint] = gradientFor(current?.album || current?.title || '');

  if (!current) {
    return (
      <View style={[styles.root, styles.center]}>
        <EmptyState icon="musical-notes-outline" title="Nothing playing" message="Play a song to see its lyrics.">
          <IconButton icon="chevron-down" label="Close" variant="filled" onPress={close} />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: tint }]}>
      <Backdrop track={current} tint={tint} />
      <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
        <IconButton icon="chevron-down" label="Close lyrics" size={28} onPress={close} />
        <View style={styles.headerText}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.centerText}>
            {current.title}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1} style={styles.centerText}>
            {current.artist}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : lyrics?.synced?.length ? (
          <SyncedLyrics key={current.key} lines={lyrics.synced} source={lyrics.source} />
        ) : hasLyrics(lyrics) ? (
          <PlainLyrics key={current.key} lyrics={lyrics!} />
        ) : (
          <NoLyrics instrumental={!!lyrics?.instrumental} failed={isError} onRetry={refetch} />
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <SeekBar key={current.key} fallbackDurationMs={current.durationMs} />
        <MiniTransport />
      </View>
    </View>
  );
}

/** Blurred cover tinted with the album's colour, expanding the lyrics card. */
function Backdrop({ track, tint }: { track: AppTrack; tint: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      <ArtworkBackdrop uri={track.artworkUri} blurRadius={90} transition={300} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.5 }]} />
      <LinearGradient
        colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.65)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

// --- Synced ----------------------------------------------------------------------------------

function SyncedLyrics({ lines, source }: { lines: LyricLine[]; source: Lyrics['source'] }) {
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);
  const ys = useRef<number[]>([]);
  const holdUntil = useRef(0);
  const laidOut = useRef(0);
  /** All lines measured: the first follow waits for this so it can jump straight to the line, without a sweep. */
  const [ready, setReady] = useState(false);
  const placed = useRef(false);
  const [viewportH, setViewportH] = useState(height * 0.6);
  const active = useActiveLyric(lines);

  const follow = (index: number, animated = true) => {
    const y = ys.current[Math.max(0, index)];
    if (y === undefined) return false;
    scroll.current?.scrollTo({ y: Math.max(0, y - viewportH * 0.3), animated });
    return true;
  };

  useEffect(() => {
    if (Date.now() < holdUntil.current) return;
    // Opening mid-song lands on the current line at once; after that, glide line to line.
    if (follow(active, placed.current)) placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow reads refs; re-run only when the line changes
  }, [active, viewportH, ready]);

  const measure = (i: number, y: number) => {
    if (ys.current[i] === undefined && ++laidOut.current === lines.length) setReady(true);
    ys.current[i] = y;
  };

  const hold = () => {
    holdUntil.current = Date.now() + USER_SCROLL_HOLD_MS;
  };

  const seek = (i: number) => {
    haptics.select();
    holdUntil.current = 0;
    player.seekTo(lines[i].timeMs);
    player.play();
    follow(i);
  };

  return (
    <ScrollView
      ref={scroll}
      style={styles.flex}
      contentContainerStyle={[styles.lines, { paddingBottom: viewportH * 0.6 }]}
      showsVerticalScrollIndicator={false}
      onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
      onScrollBeginDrag={hold}
      onMomentumScrollEnd={hold}
      onScrollEndDrag={hold}>
      {lines.map((l, i) => (
        <SyncedLine
          key={i}
          index={i}
          text={l.text}
          state={i === active ? 'active' : i < active ? 'past' : 'future'}
          onPress={seek}
          onMeasure={measure}
        />
      ))}
      <Credit source={source} />
    </ScrollView>
  );
}

type LineState = 'past' | 'active' | 'future';
const OPACITY: Record<LineState, number> = { past: 0.62, active: 1, future: 0.38 };

const SyncedLine = memo(function SyncedLine({
  index,
  text,
  state,
  onPress,
  onMeasure,
}: {
  index: number;
  text: string;
  state: LineState;
  onPress: (i: number) => void;
  onMeasure: (i: number, y: number) => void;
}) {
  const styles = useStyles();
  const o = useSharedValue(OPACITY[state]);
  const s = useSharedValue(state === 'active' ? 1 : 0.97);
  useEffect(() => {
    o.set(withTiming(OPACITY[state], { duration: 280 }));
    s.set(withTiming(state === 'active' ? 1 : 0.97, { duration: 280 }));
  }, [state, o, s]);
  const style = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ scale: s.get() }] }));
  const gap = !text;
  return (
    <Pressable onPress={() => onPress(index)} onLayout={(e: LayoutChangeEvent) => onMeasure(index, e.nativeEvent.layout.y)} accessibilityRole="button" accessibilityLabel={text || 'Instrumental break'}>
      <Animated.View style={[styles.lineWrap, style]}>
        <Text style={gap ? styles.gap : styles.line}>{gap ? '♪' : text}</Text>
      </Animated.View>
    </Pressable>
  );
});

// --- Plain / none ----------------------------------------------------------------------------

function PlainLyrics({ lyrics }: { lyrics: Lyrics }) {
  const styles = useStyles();
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.lines} showsVerticalScrollIndicator={false}>
      <View style={styles.notice}>
        <Icon name="time-outline" size={14} color="rgba(255,255,255,0.75)" />
        <Text variant="caption" color="rgba(255,255,255,0.75)">
          These lyrics aren’t synced to the song yet.
        </Text>
      </View>
      <Text style={styles.plain}>{lyrics.plain}</Text>
      <Credit source={lyrics.source} />
    </ScrollView>
  );
}

function NoLyrics({ instrumental, failed, onRetry }: { instrumental: boolean; failed: boolean; onRetry(): void }) {
  const styles = useStyles();
  return (
    <View style={[styles.flex, styles.center]}>
      <EmptyState
        icon={instrumental ? 'musical-notes-outline' : failed ? 'cloud-offline-outline' : 'musical-notes-outline'}
        title={instrumental ? 'Instrumental' : failed ? 'Couldn’t load lyrics' : 'No lyrics for this song'}
        message={
          instrumental
            ? 'Just enjoy the music.'
            : failed
              ? 'Check your connection and try again.'
              : 'Put a .lrc file with the same name next to the song on your server to add them.'
        }>
        {failed && !instrumental ? <PrimaryButton label="Try again" icon="refresh" variant="surface" onPress={onRetry} /> : null}
      </EmptyState>
    </View>
  );
}

function Credit({ source }: { source: Lyrics['source'] }) {
  const styles = useStyles();
  if (source !== 'lrclib') return null;
  return (
    <Text variant="caption" color="rgba(255,255,255,0.6)" style={styles.credit}>
      Lyrics from LRCLIB
    </Text>
  );
}

function MiniTransport() {
  const styles = useStyles();
  const colors = useColors();
  const { mode, label } = usePlayButton();
  return (
    <View style={styles.transport}>
      <IconButton icon="play-skip-back" label="Previous" size={28} diameter={52} haptic onPress={player.previous} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: mode === 'busy' }}
        activeScale={0.9}
        onPress={() => {
          haptics.press();
          player.togglePlay();
        }}
        style={styles.playButton}>
        {mode === 'busy' && <BusyRing size={58} color={colors.black} />}
        <Icon name={mode === 'play' ? 'play' : 'pause'} size={30} color={colors.black} />
      </PressableScale>
      <IconButton icon="play-skip-forward" label="Next" size={28} diameter={52} haptic onPress={player.next} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingBottom: space.sm },
  headerText: { flex: 1, minWidth: 0, gap: 1 },
  headerSpacer: { width: 44 },
  centerText: { textAlign: 'center' },
  body: { flex: 1 },
  lines: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  lineWrap: { transformOrigin: 'left center' },
  line: { color: colors.white, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 },
  gap: { color: colors.white, fontSize: 24, lineHeight: 34, fontWeight: '800' },
  plain: { color: colors.white, fontSize: 22, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  credit: { marginTop: space.lg },
  footer: { paddingHorizontal: space.xl, gap: space.sm },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xxl },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
}));
