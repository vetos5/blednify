import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, useColors, withAlpha } from '../theme';
import { Backdrop } from './Backdrop';

/** How far content scrolls before the scrim is fully in. */
const FADE_PX = 24;
/** Below the status bar a soft shadow runs on this far, so content isn't cut at a hard edge. */
const TAIL_PX = 20;

/**
 * Scroll wiring for lists that can't take a Reanimated scroll handler (FlashList): a plain onScroll that feeds the
 * scrim. Only the first FADE_PX matter, so past that nothing is written and a long scroll costs no extra work.
 */
export function useScrimScroll(): {
  scrollY: SharedValue<number>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const scrollY = useSharedValue(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = Math.min(Math.max(e.nativeEvent.contentOffset.y, 0), FADE_PX);
      if (scrollY.get() !== y) scrollY.set(y);
    },
    [scrollY],
  );
  return { scrollY, onScroll };
}

/**
 * Keeps the clock and status icons readable over scrolled content. The band behind the status bar is the screen's own
 * background drawn again (colors.bg plus the theme Backdrop, or the `surface` passed in, such as the player's
 * art-tinted cover) and clipped to the status bar, so it is opaque — nothing ghosts behind the clock — yet matches
 * what is around it instead of laying a flat slab over a star sky, glow or cover. It fades in as soon as anything
 * scrolls under it (invisible at the top, so the first frame looks as designed), and a short soft tail keeps the cut
 * from reading as a hard line. Decorative and touch-transparent. Native only: the web app has no status bar.
 *
 * Render it as a direct child of the screen root (the same box the background fills), so the copy lines up.
 */
export function StatusBarScrim({ scrollY, surface }: { scrollY: SharedValue<number>; surface?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // The background is laid out against the whole screen root; its copy must be too, or a glow or cover would shift.
  const [rootH, setRootH] = useState(0);
  const shown = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.get(), [0, FADE_PX], [0, 1], 'clamp') }));
  if (Platform.OS === 'web' || insets.top <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={styles.root}
      onLayout={(e) => setRootH(Math.round(e.nativeEvent.layout.height))}>
      {rootH > 0 ? (
        <Animated.View style={[styles.band, { height: insets.top + TAIL_PX }, shown]}>
          <View style={[styles.slice, { height: insets.top }]}>
            <View style={[styles.slice, { height: rootH, backgroundColor: colors.bg }]}>{surface ?? <Backdrop still />}</View>
          </View>
          <LinearGradient colors={[withAlpha(colors.bg, 0.5), withAlpha(colors.bg, 0)]} style={[styles.tail, { top: insets.top }]} />
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
