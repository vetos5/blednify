import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { makeStyles, useColors, withAlpha } from '../theme';
import { Backdrop } from './Backdrop';

/** How far content scrolls before the scrim is fully in. */
const FADE_PX = 24;
/** Below the status bar a soft shadow runs on this far, so content isn't cut at a hard edge. */
const TAIL_PX = 20;
/** Where the tail starts: the bg shade over a flat background, a sky or glow, and a custom surface (the player's art). */
const TAIL_ALPHA = 0.5;
const TAIL_ALPHA_OVER_BACKDROP = 0.12;
const TAIL_ALPHA_OVER_COVER = 0.05;
/** How long the copy stays mounted after scrolling back to the top, so flicking around the top doesn't remount it. */
const UNMOUNT_AFTER_MS = 1500;

/**
 * Scroll wiring for lists that can't take a Reanimated scroll handler (FlashList): a plain onScroll that feeds the
 * scrim. Only the first FADE_PX matter, so past that nothing is written and a long scroll costs no extra work.
 *
 * `follow` also tracks the offset itself up to that many px (`offsetY`), for a band that copies a background which
 * scrolls with the content (a detail page's cover glow): past it the copy no longer changes, so writes stop again.
 */
export function useScrimScroll(follow = 0): {
  scrollY: SharedValue<number>;
  offsetY: SharedValue<number>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const scrollY = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw = Math.max(e.nativeEvent.contentOffset.y, 0);
      const y = Math.min(raw, FADE_PX);
      if (scrollY.get() !== y) scrollY.set(y);
      if (follow > 0) {
        const o = Math.min(raw, follow);
        if (offsetY.get() !== o) offsetY.set(o);
      }
    },
    [scrollY, offsetY, follow],
  );
  return { scrollY, offsetY, onScroll };
}

/**
 * Keeps the clock and status icons readable over scrolled content. The band behind the status bar is the screen's own
 * background drawn again (colors.bg plus the theme Backdrop, or the `surface` passed in, such as the player's
 * art-tinted cover or a detail page's cover glow at its scroll offset) and clipped to the status bar, so it is opaque
 * (nothing ghosts behind the clock) yet matches what is around it instead of laying a flat slab over a star sky, glow
 * or cover. It fades in as soon as anything scrolls under it (invisible at the top, so the first frame looks as
 * designed), and a short soft tail keeps the cut from reading as a hard line. Decorative and touch-transparent.
 * Native only: the web app has no status bar.
 *
 * Render it as a direct child of the screen root (the same box the background fills), so the copy lines up.
 *
 * The copy is mounted only while something is scrolled under the clock (it is fully transparent at the top anyway),
 * so a screen at rest, and the player on a song change, never pay for a second background (on the player a second
 * full-size blurred cover). It lingers briefly after returning to the top, so scrolling about the top doesn't remount
 * it every time.
 */
export function StatusBarScrim({ scrollY, surface }: { scrollY: SharedValue<number>; surface?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // The background is laid out against the whole screen root; its copy must be too, or a glow or cover would shift.
  const [rootH, setRootH] = useState(0);
  const [mounted, setMounted] = useState(false);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrolledChange = useCallback((scrolled: boolean) => {
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = null;
    if (scrolled) setMounted(true);
    else unmountTimer.current = setTimeout(() => setMounted(false), UNMOUNT_AFTER_MS);
  }, []);
  useEffect(
    () => () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
    },
    [],
  );
  useAnimatedReaction(
    () => scrollY.get() > 0,
    (now, before) => {
      // The first run (before === null) only matters if the screen opens already scrolled.
      if (now !== (before ?? false)) scheduleOnRN(onScrolledChange, now);
    },
  );
  const shown = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.get(), [0, FADE_PX], [0, 1], 'clamp') }));
  // The tail is a plain shade, not part of the copy, so it is all that marks the band's edge. A flat background takes
  // the full bg shade. Over a sky it is light, or it would draw a stripe under the clock where nothing is scrolled, and
  // on a dark sky it is black rather than bg: black only darkens, so the stripe keeps the sky's hue instead of tinting a
  // warm sky (Starry night's gold glow) towards the cool bg. A surface copy (the player's art, a detail page's glow)
  // already matches what is under it, so there the tail only hints at the edge.
  const tailAlpha = surface ? TAIL_ALPHA_OVER_COVER : colors.backdrop !== 'none' ? TAIL_ALPHA_OVER_BACKDROP : TAIL_ALPHA;
  const tailShade = !surface && colors.backdrop !== 'none' && !colors.isLight ? colors.black : colors.bg;
  if (Platform.OS === 'web' || insets.top <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={styles.root}
      onLayout={(e) => setRootH(Math.round(e.nativeEvent.layout.height))}>
      {rootH > 0 && mounted ? (
        <Animated.View
          // While it fades in, the band must blend in as one picture. Without an offscreen layer Android fades each
          // child on its own (bg, sky, cover, its veil), and the stack came out up to 12 levels darker than the page.
          needsOffscreenAlphaCompositing
          style={[styles.band, { height: insets.top + TAIL_PX }, shown]}>
          <View style={[styles.slice, { height: insets.top }]}>
            <View style={[styles.slice, { height: rootH, backgroundColor: colors.bg }]}>{surface ?? <Backdrop still />}</View>
          </View>
          <LinearGradient colors={[withAlpha(tailShade, tailAlpha), withAlpha(tailShade, 0)]} style={[styles.tail, { top: insets.top }]} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  band: { position: 'absolute', top: 0, left: 0, right: 0 },
  slice: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  tail: { position: 'absolute', left: 0, right: 0, height: TAIL_PX },
}));
