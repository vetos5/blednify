import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  GestureDetector,
  useNativeGesture,
  usePanGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import {
  hasLyrics,
  player,
  useLyrics,
  usePlayButton,
  usePlayer,
  usePrefetchLyrics,
  type AppTrack,
  type RepeatMode,
} from '@/core';
import { Artwork, ArtworkBackdrop } from '@/ui/components/Artwork';
import { DownloadButton } from '@/ui/components/DownloadButton';
import { EmptyState } from '@/ui/components/EmptyState';
import { ImmersiveStatusBar } from '@/ui/components/ImmersiveStatusBar';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { LikeButton } from '@/ui/components/LikeButton';
import { PlaylistPicker } from '@/ui/components/PlaylistPicker';
import { BusyRing } from '@/ui/components/BusyRing';
import { ArtistCard } from '@/ui/components/player/ArtistCard';
import { FileInfoCard } from '@/ui/components/player/FileInfoCard';
import { LyricsCard } from '@/ui/components/player/LyricsCard';
import { UpNextCard } from '@/ui/components/player/UpNextCard';
import { PressableScale } from '@/ui/components/PressableScale';
import { SeekBar } from '@/ui/components/SeekBar';
import { StatusBarScrim } from '@/ui/components/StatusBarScrim';
import { Text } from '@/ui/components/Text';
import { openTrackActions } from '@/ui/components/TrackActions';
import { DesktopNowPlaying } from '@/ui/desktop/NowPlaying';
import { haptics } from '@/ui/haptics';
import { useIsWide } from '@/ui/layout';
import { goBack, nav } from '@/ui/nav';
import { dropScreenToast, showSheet } from '@/ui/overlay';
import { ForceDark, makeStyles, radius, space, useColors, webLayer, withAlpha } from '@/ui/theme';
import { spokenLabel } from '@/ui/a11y';

const DISMISS_DISTANCE = 140;
const IS_WEB = Platform.OS === 'web';

const dismiss = goBack;

/** Finishes a pull-down: closes past the distance or on a flick, otherwise springs back. */
function settleSheet(y: SharedValue<number>, translationY: number, velocityY: number, screenH: number) {
  'worklet';
  if (translationY > DISMISS_DISTANCE || velocityY > 1100) {
    // The route changes only after the slide-out; the player's own note goes with the sheet now.
    scheduleOnRN(dropScreenToast);
    y.set(
      withTiming(screenH, { duration: 200, easing: Easing.out(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(dismiss);
      }),
    );
  } else {
    y.set(withSpring(0, { damping: 22, stiffness: 260 }));
  }
}

/**
 * Web pull-down-to-close. On web the scroll view isn't wrapped in a gesture detector: the detector puts
 * `touch-action: none` on it, so touch never scrolled the page. The browser scrolls natively instead, and
 * a drag that starts at the top and moves down cancels its touchmoves and drags the sheet.
 */
function useWebPullToDismiss(
  ref: RefObject<ComponentRef<typeof View> | null>,
  scrollY: SharedValue<number>,
  y: SharedValue<number>,
  screenH: number,
) {
  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!IS_WEB || !el?.addEventListener) return;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let claim: 'none' | 'pull' | 'scroll' = 'none';
    const onStart = (e: TouchEvent) => {
      startY = lastY = e.touches[0]?.clientY ?? 0;
      lastT = e.timeStamp;
      velocity = 0;
      claim = e.touches.length > 1 ? 'scroll' : 'none';
    };
    const onMove = (e: TouchEvent) => {
      const touchY = e.touches[0]?.clientY ?? lastY;
      const dy = touchY - startY;
      if (claim === 'none') {
        if (scrollY.get() > 1 || dy < 0) claim = 'scroll';
        else if (dy > 0) claim = 'pull';
      }
      if (claim !== 'pull') return;
      if (e.cancelable) e.preventDefault();
      if (e.timeStamp > lastT) velocity = ((touchY - lastY) / (e.timeStamp - lastT)) * 1000;
      lastY = touchY;
      lastT = e.timeStamp;
      y.set(Math.max(0, dy));
    };
    const onEnd = () => {
      if (claim === 'pull') settleSheet(y, lastY - startY, velocity, screenH);
      claim = 'none';
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref, scrollY, y, screenH]);
}

/** Immersive screen over artwork: stays dark in light themes. */
export default function PlayerScreen() {
  const wide = useIsWide();
  const [sheetDown, setSheetDown] = useState(false);
  return (
    <ForceDark>
      <ImmersiveStatusBar released={sheetDown} />
      {wide ? <DesktopNowPlaying /> : <PlayerScreenContent onSheetDownChange={setSheetDown} />}
    </ForceDark>
  );
}

function PlayerScreenContent({ onSheetDownChange }: { onSheetDownChange: (down: boolean) => void }) {
  const styles = useStyles();
  const current = usePlayer((s) => s.current);
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const y = useSharedValue(0);
  // Once the sheet's top edge passes the middle of the status bar the clock sits over the page beneath, so the
  // player's light bar hands back to the theme's (it was white on white while dismissing over a Daylight page).
  const releaseAt = Math.max(insets.top / 2, 1);
  useAnimatedReaction(
    () => y.get() > releaseAt,
    (down, before) => {
      if (down !== (before ?? false)) scheduleOnRN(onSheetDownChange, down);
    },
  );
  const scrollY = useSharedValue(0);
  const listDrag = useSharedValue(false);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const sheetRef = useRef<ComponentRef<typeof View>>(null);
  // The first page fills the scroll viewport exactly; window height can disagree with it on Android.
  const [pageH, setPageH] = useState(screenH);

  const native = useNativeGesture();

  const pan = usePanGesture({
    activeOffsetY: 14,
    failOffsetX: [-24, 24],
    onActivate: () => {
      'worklet';
      listDrag.set(scrollY.get() > 1);
    },
    onUpdate: (e) => {
      'worklet';
      if (!listDrag.get()) {
        y.set(Math.max(0, e.translationY));
      }
    },
    onDeactivate: (e) => {
      'worklet';
      if (listDrag.get()) return;
      settleSheet(y, e.translationY, e.velocityY, screenH);
    },
  });

  const gesture = useSimultaneousGestures(pan, native);
  useWebPullToDismiss(sheetRef, scrollY, y, screenH);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.get() }],
    // Changing a clip's radius on every drag frame repaints the full sheet in browsers.
    borderRadius: IS_WEB ? (y.get() > 0 ? radius.xl : 0) : interpolate(y.get(), [0, 80], [0, radius.xl], 'clamp'),
  }));

  const page = current ? (
    <Animated.ScrollView
      ref={scrollRef}
      bounces={false}
      overScrollMode="never"
      scrollEventThrottle={16}
      onScroll={scrollHandler}
      showsVerticalScrollIndicator={false}
      onLayout={(e) => setPageH(Math.round(e.nativeEvent.layout.height))}
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}>
      <NowPlaying
        track={current}
        pageHeight={pageH}
        onScrollToLyrics={() => {
          scrollRef.current?.scrollTo({ y: pageH, animated: true });
        }}
      />
    </Animated.ScrollView>
  ) : null;

  return (
    <Animated.View ref={sheetRef} style={[styles.sheet, sheetStyle]}>
      <Backdrop uri={current?.artworkUri ?? null} />
      {page && IS_WEB ? (
        // Web scrolls natively and closes via useWebPullToDismiss: the detector would block touch scrolling.
        page
      ) : page ? (
        <GestureDetector gesture={gesture}>{page}</GestureDetector>
      ) : (
        <GestureDetector gesture={pan}>
          <View style={styles.empty}>
            <EmptyState
              icon="musical-notes-outline"
              title="Nothing playing"
              message="Pick something from your library to start listening.">
              <IconButton icon="chevron-down" label="Close" variant="filled" onPress={dismiss} />
            </EmptyState>
          </View>
        </GestureDetector>
      )}
      {/* Over everything that scrolls: cover art, the Lyrics card and the rest slide under the clock otherwise. The
          band is the backdrop's own (art-tinted) top, not a flat dark slab over it. */}
      {page ? (
        <StatusBarScrim
          scrollY={scrollY}
          lazy
          surface={<Backdrop uri={current?.artworkUri ?? null} />}
        />
      ) : null}
    </Animated.View>
  );
}

function NowPlaying({
  track,
  pageHeight: height,
  onScrollToLyrics,
}: {
  track: AppTrack;
  pageHeight: number;
  onScrollToLyrics: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isPlaying = usePlayer((s) => s.isPlaying);
  const { lyrics } = useLyrics(track);
  usePrefetchLyrics(usePlayer((s) => s.queue[s.index + 1]));
  const withLyrics = hasLyrics(lyrics);

  // One layout for every song: the cover size, the title row and the lyrics hint's slot never depend on the
  // track, so skipping never moves anything (covers used to resize between songs with and without lyrics, and
  // jump while the next song's lyrics loaded).
  const isSmallScreen = height <= 740;
  // The cover fills the space left for it (the same for every song); until that is measured, a safe guess.
  const [artBox, setArtBox] = useState(0);
  const art = Math.min(width - space.xl * 2, artBox > 0 ? artBox - space.sm : height * (isSmallScreen ? 0.3 : 0.33));

  const goArtist = () => {
    goBack();
    nav.artist(track.artistId, track.origin);
  };
  const goAlbum = () => {
    goBack();
    nav.album(track.albumId, track.origin);
  };

  return (
    <>
      <View
        style={[
          styles.firstPage,
          {
            height,
            paddingTop: insets.top + (isSmallScreen ? space.xxs : space.xs),
            paddingBottom: insets.bottom + (isSmallScreen ? space.sm : space.md),
            gap: isSmallScreen ? space.sm : space.md,
          },
        ]}>
        <View style={styles.topBar}>
          <IconButton icon="chevron-down" label="Close player" size={28} onPress={dismiss} />
          <Pressable
            style={styles.topCenter}
            disabled={!track.album}
            onPress={goAlbum}
            accessibilityRole="button"
            accessibilityLabel={spokenLabel(`Album ${track.album}`)}>
            <Text variant="micro">NOW PLAYING</Text>
            <Text variant="caption" color={colors.text} numberOfLines={1} style={styles.bold}>
              {track.album || 'Single'}
            </Text>
          </Pressable>
          <IconButton
            icon="ellipsis-horizontal"
            label="More options"
            onPress={() => openTrackActions(track, { beforeNavigate: goBack })}
          />
        </View>

        <View style={styles.artArea} onLayout={(e) => setArtBox(Math.floor(e.nativeEvent.layout.height))}>
          <PulsingArtwork track={track} size={art} playing={isPlaying} />
        </View>

        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text variant="title" numberOfLines={1}>
              {track.title}
            </Text>
            <Pressable
              onPress={goArtist}
              hitSlop={6}
              accessibilityRole="link"
              accessibilityLabel={`Artist ${track.artist}`}>
              <Text
                variant="body"
                color={colors.textSecondary}
                numberOfLines={1}
                style={styles.artist}>
                {track.artist}
              </Text>
            </Pressable>
          </View>
          <LikeButton track={track} size={28} />
        </View>

        <SeekBar key={track.key} fallbackDurationMs={track.durationMs} />

        <Transport />

        {/* Always laid out (hidden without lyrics) so the screen doesn't shift when it comes and goes. */}
        <Pressable
          onPress={onScrollToLyrics}
          disabled={!withLyrics}
          hitSlop={8}
          style={[styles.lyricsHint, !withLyrics && styles.hidden]}
          pointerEvents={withLyrics ? 'auto' : 'none'}
          accessibilityElementsHidden={!withLyrics}
          importantForAccessibility={withLyrics ? 'auto' : 'no-hide-descendants'}
          aria-hidden={!withLyrics}
          accessibilityRole="button"
          accessibilityLabel="Scroll to lyrics">
          <Text variant="micro" color={colors.textSecondary} style={styles.lyricsHintText}>
            LYRICS
          </Text>
          <Icon name="chevron-down" size={14} color={colors.textSecondary} />
        </Pressable>

        <View style={styles.bottomRow}>
          <DownloadButton track={track} />
          <IconButton
            icon="add-circle-outline"
            label="Add to playlist"
            size={26}
            onPress={() => showSheet(<PlaylistPicker tracks={[track]} />)}
          />
          <IconButton icon="list" label="Queue" size={26} onPress={nav.queue} />
        </View>
      </View>

      <View
        style={[
          styles.cardsSection,
          {
            paddingBottom: insets.bottom + space.xxl,
          },
        ]}>
        {withLyrics && lyrics ? <LyricsCard track={track} lyrics={lyrics} /> : null}
        <UpNextCard />
        <ArtistCard track={track} />
        <FileInfoCard track={track} />
      </View>
    </>
  );
}

function Backdrop({ uri }: { uri: string | null }) {
  const colors = useColors();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <ArtworkBackdrop uri={uri} blurRadius={70} transition={300} />
      <LinearGradient
        colors={
          uri
            ? [withAlpha(colors.bg, 0.45), withAlpha(colors.bg, 0.78), withAlpha(colors.bg, 0.96)]
            : [colors.accentDeep, colors.bg, colors.bg]
        }
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/**
 * The cover is laid out once at the largest size it can take on this screen and only ever
 * scaled with a transform. Animating width/height resized the native image view every frame,
 * which made expo-image re-decode (and blank) the cover while the player opened or skipped.
 */
function PulsingArtwork({
  track,
  size,
  playing,
}: {
  track: AppTrack;
  size: number;
  playing: boolean;
}) {
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const base = Math.round(Math.max(size, Math.min(width - space.xl * 2, height * 0.4)));
  const pulse = useSharedValue(playing ? 1 : 0.86);
  const fit = useSharedValue(size / base);
  useEffect(() => {
    pulse.set(withSpring(playing ? 1 : 0.86, { damping: 15, stiffness: 140 }));
  }, [playing, pulse]);
  useEffect(() => {
    // Size only changes with the window (never per song), so no animation.
    fit.set(size / base);
  }, [size, base, fit]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.get() * fit.get() }],
    shadowOpacity: IS_WEB ? (playing ? 0.6 : 0.25) : interpolate(pulse.get(), [0.86, 1], [0.25, 0.6]),
  }));
  // Counter the fit scale so the on-screen corner radius stays radius.lg.
  const corner = (radius.lg * base) / size;
  return (
    <Animated.View
      style={[styles.artShadow, { width: base, height: base, borderRadius: corner }, style]}>
      <Artwork
        uri={track.artworkUri}
        label={track.album || track.title}
        size={base}
        radius={corner}
        recyclingKey={track.key}
        priority="high"
      />
    </Animated.View>
  );
}

const REPEAT_ICON: Record<RepeatMode, { label: string; badge?: string }> = {
  off: { label: 'Repeat off' },
  all: { label: 'Repeat all' },
  one: { label: 'Repeat one', badge: '1' },
};

function Transport() {
  const styles = useStyles();
  const colors = useColors();
  const { mode, label } = usePlayButton();
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);

  return (
    <View style={styles.transport}>
      <IconButton
        icon="shuffle"
        label={shuffle ? 'Shuffle on' : 'Shuffle off'}
        size={24}
        color={shuffle ? colors.accentText : colors.textSecondary}
        haptic
        onPress={player.toggleShuffle}
      />
      <IconButton
        icon="play-skip-back"
        label="Previous"
        size={32}
        diameter={56}
        haptic
        onPress={player.previous}
      />
      <PressableScale
        accessibilityRole="button"
        // While loading or retrying the tap pauses (cancels the pending start), so the label says so.
        accessibilityLabel={label}
        accessibilityState={{ busy: mode === 'busy' }}
        // react-native-web drops accessibilityState.busy; aria-busy reaches the PWA's screen reader too.
        aria-busy={mode === 'busy' || undefined}
        activeScale={0.9}
        onPress={() => {
          haptics.press();
          player.togglePlay();
        }}
        style={styles.playButton}>
        {/* Busy is the same Pause with a ring around the button's edge: tapping stops the load or a network retry. */}
        {mode === 'busy' && <BusyRing size={70} color={colors.onAccent} />}
        <Icon name={mode === 'play' ? 'play' : 'pause'} size={34} color={colors.onAccent} />
      </PressableScale>
      <IconButton
        icon="play-skip-forward"
        label="Next"
        size={32}
        diameter={56}
        haptic
        onPress={player.next}
      />
      <View>
        <IconButton
          icon="repeat"
          label={REPEAT_ICON[repeat].label}
          size={24}
          color={repeat === 'off' ? colors.textSecondary : colors.accentText}
          haptic
          onPress={player.cycleRepeat}
        />
        {REPEAT_ICON[repeat].badge ? (
          <View style={styles.repeatBadge} pointerEvents="none">
            <Text style={styles.repeatBadgeText}>{REPEAT_ICON[repeat].badge}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  sheet: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden', ...webLayer },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center' },
  firstPage: {
    paddingHorizontal: space.xl,
    justifyContent: 'space-between',
  },
  topBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -space.md },
  topCenter: { flex: 1, alignItems: 'center', gap: 2 },
  bold: { fontWeight: '700' },
  // overflow visible: the art's layout box is its max size, scaled down to fit.
  artArea: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  artShadow: {
    ...webLayer,
    position: 'absolute',
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    shadowColor: colors.black,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 20,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  titleText: { flex: 1, minWidth: 0, gap: 2 },
  artist: { fontSize: 17, lineHeight: 22 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lyricsHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.xxs,
    alignSelf: 'center',
  },
  hidden: { opacity: 0 },
  lyricsHintText: {
    letterSpacing: 1,
    fontWeight: '700',
  },
  playButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  repeatBadge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatBadgeText: { color: colors.onAccent, fontSize: 9, lineHeight: 11, fontWeight: '800' },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: -space.md,
  },
  cardsSection: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.lg,
  },
}));
