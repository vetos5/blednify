import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { makeStyles, useColors } from '../theme';

const BARS = [
  { min: 0.25, max: 1, duration: 420, rest: 0.45 },
  { min: 0.35, max: 0.8, duration: 560, rest: 0.75 },
  { min: 0.2, max: 0.95, duration: 360, rest: 0.35 },
] as const;

/** Animated "now playing" bars. Runs fully on the UI thread; freezes when paused. */
export function Equalizer({ playing, size = 14, color: colorProp }: { playing: boolean; size?: number; color?: string }) {
  const styles = useStyles();
  const accent = useColors().accent;
  const color = colorProp ?? accent;
  return (
    <View style={[styles.row, { height: size, width: size }]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      {BARS.map((bar, i) => (
        <Bar key={i} bar={bar} playing={playing} color={color} />
      ))}
    </View>
  );
}

function Bar({ bar, playing, color }: { bar: (typeof BARS)[number]; playing: boolean; color: string }) {
  const h = useSharedValue<number>(bar.rest);
  useEffect(() => {
    if (playing) {
      const ease = Easing.inOut(Easing.quad);
      h.set(
        withRepeat(
          withSequence(withTiming(bar.max, { duration: bar.duration, easing: ease }), withTiming(bar.min, { duration: bar.duration, easing: ease })),
          -1,
          true,
        ),
      );
    } else {
      cancelAnimation(h);
      h.set(withTiming(bar.rest, { duration: 180 }));
    }
    return () => cancelAnimation(h);
  }, [playing, bar, h]);
  return <BarView h={h} color={color} />;
}

function BarView({ h, color }: { h: SharedValue<number>; color: string }) {
  const styles = useStyles();
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: h.get() }] }));
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bar: { width: '24%', height: '100%', borderRadius: 1.5, transformOrigin: 'bottom' },
}));
