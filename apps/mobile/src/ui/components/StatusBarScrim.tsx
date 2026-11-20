import { LinearGradient } from 'expo-linear-gradient';
import { useCallback } from 'react';
import { Platform, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, useColors, withAlpha } from '../theme';

/** How far content scrolls before the scrim is fully in. */
const FADE_PX = 24;
/** Below the status bar the gradient runs on this far, so content fades out instead of meeting a hard edge. */
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
 * Keeps the clock and status icons readable over scrolled content: a gradient from the screen's own background to
 * transparent behind the status bar, fading in as soon as anything scrolls under it (invisible at the top, so the
 * first frame looks as designed). Theme-aware via useColors, so under ForceDark (player) it is the dark background.
 * Decorative and touch-transparent. Native only: the web app has no status bar to protect.
 */
export function StatusBarScrim({ scrollY }: { scrollY: SharedValue<number> }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const shown = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.get(), [0, FADE_PX], [0, 1], 'clamp') }));
  if (Platform.OS === 'web' || insets.top <= 0) return null;
  const height = insets.top + TAIL_PX;
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[styles.scrim, { height }, shown]}>
      <LinearGradient
        colors={[withAlpha(colors.bg, 0.92), withAlpha(colors.bg, 0.8), withAlpha(colors.bg, 0)]}
        locations={[0, insets.top / height, 1]}
        style={styles.fill}
      />
    </Animated.View>
  );
}

const useStyles = makeStyles(() => ({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  fill: { flex: 1 },
}));
