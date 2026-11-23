import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { makeStyles } from '../theme';

/**
 * A spinning arc around the edge of a round button, drawn over it (absolutely positioned, centred). The glyph inside
 * keeps its size, so going busy only adds the ring; a scaled ActivityIndicator ran through the glyph instead. With
 * reduced motion the arc stands still. Decorative: the button carries the busy state and label.
 */
export function BusyRing({ size, stroke = 3, color }: { size: number; stroke?: number; color: string }) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    turn.set(0);
    turn.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Centred by a fill layer's flex alignment rather than left/top 50% with negative margins: on Android that put the
  // ring ~9dp below the glyph in the mini player. Flex centring also holds when the ring is wider than the button.
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={styles.layer}>
      <Animated.View style={[{ width: size, height: size }, spin]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c}`}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
}));
