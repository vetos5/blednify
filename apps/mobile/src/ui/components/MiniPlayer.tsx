import { useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { onProgress, player, usePlayer } from '@/core';

import { ChromeDock, ChromeSurface, useChromeStyle } from '../chrome';
import { spokenLabel } from '../a11y';
import { haptics } from '../haptics';
import { useIsWide } from '../layout';
import { nav } from '../nav';
import { makeStyles, MINI_PLAYER_HEIGHT, radius, space, useColors } from '../theme';
import { Artwork } from './Artwork';
import { IconButton } from './IconButton';
import { Text } from './Text';

const PILL_RADIUS = MINI_PLAYER_HEIGHT / 2;
const SWIPE_THRESHOLD = 72;
const OPEN_THRESHOLD = 36;

function skip(dir: 1 | -1) {
  haptics.tap();
  if (dir > 0) player.next();
  else player.previous();
}

/**
 * Mini player above the tab bar: a docked card, or a pill with the floating navigation styles.
 * Tap or swipe ↑ → Now Playing, swipe ←/→ for next/previous.
 */
export function MiniPlayer() {
  const styles = useStyles();
  const colors = useColors();
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const floating = useChromeStyle() !== 'classic';
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  /** Axis the drag locked to on activation: 0 horizontal (skip), 1 vertical (open player). */
  const axis = useSharedValue(0);

  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    activeOffsetY: -14,
    onActivate: (e) => {
      'worklet';
      axis.set(Math.abs(e.translationY) > Math.abs(e.translationX) ? 1 : 0);
    },
    onUpdate: (e) => {
      'worklet';
      if (axis.get() === 1) y.set(Math.min(0, e.translationY));
      else x.set(e.translationX);
    },
    onDeactivate: (e) => {
      'worklet';
      if (axis.get() === 1) {
        if (e.translationY < -OPEN_THRESHOLD || e.velocityY < -600) scheduleOnRN(nav.player);
      } else {
        const fling = Math.abs(e.velocityX) > 700;
        if (Math.abs(e.translationX) > SWIPE_THRESHOLD || fling) {
          scheduleOnRN(skip, e.translationX < 0 ? 1 : -1);
        }
      }
      x.set(withSpring(0, { damping: 20, stiffness: 240 }));
      y.set(withSpring(0, { damping: 20, stiffness: 240 }));
    },
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() * 0.6 }],
    opacity: interpolate(Math.abs(x.get()), [0, 160], [1, 0.4], 'clamp'),
  }));
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(y.get() * 0.4, -24) }],
  }));

  if (!current) return null;

  const card = (
      <GestureDetector gesture={pan}>
        {/* The play and next buttons are siblings of the main button, not nested in it: a screen reader on web
            can't reach a button inside a button. */}
        <View style={floating ? styles.pill : styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={spokenLabel(`Now playing: ${current.title} by ${current.artist}. Open player`)}
            onPress={nav.player}
            style={styles.main}>
            <Animated.View style={[styles.content, contentStyle]}>
              <Artwork uri={current.artworkUri} label={current.album || current.title} size={44} round={floating} recyclingKey={current.key} priority="high" />
              <View style={styles.meta}>
                {/* The bar has a fixed height (screens pad for it), so its two lines stop growing at 1.3x; the full
                    player shows the title at any size. */}
                <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={MINI_FONT_MAX}>
                  {current.title}
                </Text>
                <Text variant="caption" numberOfLines={1} maxFontSizeMultiplier={MINI_FONT_MAX}>
                  {current.artist}
                </Text>
              </View>
            </Animated.View>
          </Pressable>
          {isBuffering && !isPlaying ? (
            // Still a button: tapping while loading or retrying pauses, like the full player.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Loading, pause"
              accessibilityState={{ busy: true }}
              hitSlop={8}
              onPress={player.togglePlay}
              style={styles.spinner}>
              <ActivityIndicator size="small" color={colors.text} />
            </Pressable>
          ) : (
            <IconButton icon={isPlaying ? 'pause' : 'play'} label={isPlaying ? 'Pause' : 'Play'} size={26} haptic onPress={player.togglePlay} />
          )}
          <IconButton icon="play-skip-forward" label="Next song" size={22} haptic onPress={player.next} />
          <MiniProgress inset={floating ? PILL_RADIUS : space.sm} />
        </View>
      </GestureDetector>
  );
  return (
    <Animated.View style={[floating ? null : styles.wrap, liftStyle]}>
      {floating ? <ChromeSurface radius={PILL_RADIUS}>{card}</ChromeSurface> : card}
    </Animated.View>
  );
}

/** MiniPlayer for full-screen stack routes (album / artist / playlist) that sit above the tab bar. */
export function DockedMiniPlayer() {
  const styles = useStyles();
  const hasTrack = usePlayer((s) => s.current !== null);
  const insets = useSafeAreaInsets();
  const chrome = useChromeStyle();
  // The wide layout has a player bar under every page.
  const wide = useIsWide();
  if (!hasTrack || wide) return null;
  if (chrome !== 'classic') {
    return (
      <ChromeDock>
        <MiniPlayer />
      </ChromeDock>
    );
  }
  return (
    <View style={[styles.docked, { paddingBottom: insets.bottom }]}>
      <MiniPlayer />
    </View>
  );
}

/** Follows progress through a store subscription, so ticks never re-render React. */
function MiniProgress({ inset }: { inset: number }) {
  const styles = useStyles();
  const p = useSharedValue(0);
  useEffect(
    () =>
      onProgress(({ positionMs, durationMs }) => {
        const ratio = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
        // Native eases between ticks; web avoids a JS animation running throughout playback.
        p.set(Platform.OS === 'web' || Math.abs(p.get() - ratio) > 0.05 ? ratio : withTiming(ratio, { duration: 260, easing: Easing.linear }));
      }),
    [p],
  );
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: p.get() }] }));
  return (
    <View style={[styles.track, { left: inset, right: inset }]} pointerEvents="none">
      <Animated.View style={[styles.fill, style]} />
    </View>
  );
}

/** Largest font scale the bar's title and artist follow (see the bar). */
const MINI_FONT_MAX = 1.3;

const useStyles = makeStyles((colors) => ({
  wrap: { paddingHorizontal: space.sm, paddingBottom: space.xs },
  docked: { paddingTop: space.xs, backgroundColor: colors.bg },
  card: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.sm,
    paddingRight: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  pill: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.sm,
    paddingRight: space.sm,
    borderRadius: PILL_RADIUS,
    overflow: 'hidden',
  },
  main: { flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minWidth: 0 },
  meta: { flex: 1, minWidth: 0 },
  spinner: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  track: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  fill: { height: '100%', width: '100%', backgroundColor: colors.accent, transformOrigin: 'left' },
}));
