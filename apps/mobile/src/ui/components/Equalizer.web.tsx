import { View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { makeStyles, useColors } from '../theme';

const BARS = [
  { min: 0.25, max: 1, duration: 420, rest: 0.45 },
  { min: 0.35, max: 0.8, duration: 560, rest: 0.75 },
  { min: 0.2, max: 0.95, duration: 360, rest: 0.35 },
].map((bar) => ({
  ...bar,
  keyframes: { from: { transform: [{ scaleY: bar.min }] }, to: { transform: [{ scaleY: bar.max }] } },
}));

/** The browser animates the same bars without a permanent JavaScript frame loop. */
export function Equalizer({ playing, size = 14, color: colorProp }: { playing: boolean; size?: number; color?: string }) {
  const styles = useStyles();
  const accent = useColors().accent;
  const reducedMotion = useReducedMotion();
  const color = colorProp ?? accent;
  return (
    <View style={[styles.row, { height: size, width: size }]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      {BARS.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            { backgroundColor: color },
            playing && !reducedMotion
              ? {
                  animationName: bar.keyframes,
                  animationDuration: bar.duration,
                  animationTimingFunction: 'ease-in-out',
                  animationIterationCount: 'infinite',
                  animationDirection: 'alternate',
                }
              : { transform: [{ scaleY: bar.rest }], transitionProperty: 'transform', transitionDuration: 180 },
          ]}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bar: { width: '24%', height: '100%', borderRadius: 1.5, transformOrigin: 'bottom' },
}));
