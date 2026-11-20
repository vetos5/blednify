import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useColors, type Palette } from '../theme';

/** Deterministic PRNG so every screen draws the same sky (no jump when navigating). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Star = { x: number; y: number; r: number; o: number };

/** Static stars on a 100 x 200 grid (stretched to cover the screen). */
const STARS: Star[] = (() => {
  const rand = rng(7);
  return Array.from({ length: 110 }, () => {
    const big = rand() > 0.9;
    return { x: rand() * 100, y: rand() * 200, r: big ? 0.32 + rand() * 0.18 : 0.12 + rand() * 0.16, o: 0.25 + rand() * 0.55 };
  });
})();

type Spot = { left: `${number}%`; top: `${number}%`; size: number; delay: number; duration: number };

/**
 * Every twinkle and meteor runs on one shared cycle: a burst of motion, then a still gap. Any change in the
 * backdrop redraws the whole window (glass blur included), so constant twinkling kept the GPU busy and the
 * battery draining even with the app idle. Within a cycle, motion happens in the first ~4 s only.
 */
const CYCLE_MS = 10_000;

function spots(seed: number, count: number, minSize: number, sizeRange: number): Spot[] {
  const rand = rng(seed);
  return Array.from({ length: count }, () => ({
    left: `${4 + rand() * 92}%`,
    top: `${3 + rand() * 85}%`,
    size: minSize + Math.round(rand() * sizeRange),
    // Start offset inside the burst, and the rise time (the fall takes as long).
    delay: Math.round(rand() * 1600),
    duration: 700 + Math.round(rand() * 500),
  }));
}

/** Brighter stars that twinkle (Starry night). */
const TWINKLERS = spots(42, 9, 2, 2);
/** Haloed stars and four-point sparkles (Night sky). */
const GLOWS = spots(11, 10, 3, 2);
const SPARKLES = spots(23, 8, 9, 6);

/** Brightness between twinkles. */
const TWINKLE_REST = 0.35;

/**
 * One twinkle per cycle (rest → 1 → rest, `delay` into the cycle), then still until the next cycle.
 * Static (fully on) when not animating.
 */
function useTwinkle(animate: boolean, delay: number, duration: number) {
  const o = useSharedValue(animate ? TWINKLE_REST : 1);
  useEffect(() => {
    if (!animate) {
      o.value = 1;
      return;
    }
    const ease = Easing.inOut(Easing.quad);
    o.value = TWINKLE_REST;
    o.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration, easing: ease }),
          withTiming(TWINKLE_REST, { duration, easing: ease }),
          // Hold still for the rest of the cycle (no frames are drawn while nothing changes).
          withDelay(CYCLE_MS - 2 * duration, withTiming(TWINKLE_REST, { duration: 0 })),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(o);
  }, [o, animate, delay, duration]);
  return o;
}

function Twinkle({ spot, color, animate }: { spot: Spot; color: string; animate: boolean }) {
  const o = useTwinkle(animate, spot.delay, spot.duration);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: 0.7 + o.value * 0.5 }] }));
  const { left, top, size } = spot;
  return (
    <Animated.View
      style={[
        { position: 'absolute', left, top, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        { shadowColor: color, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
        style,
      ]}
    />
  );
}

/** A star with a soft halo (two translucent rings around a bright core). */
function GlowStar({ spot, color, animate }: { spot: Spot; color: string; animate: boolean }) {
  const o = useTwinkle(animate, spot.delay, spot.duration + 300);
  const style = useAnimatedStyle(() => ({ opacity: 0.45 + o.value * 0.55 }));
  const halo = spot.size * 5;
  return (
    <Animated.View
      style={[{ position: 'absolute', left: spot.left, top: spot.top, width: halo, height: halo, marginLeft: -halo / 2, marginTop: -halo / 2 }, style]}
    >
      <View style={[styles.center, { width: halo, height: halo, borderRadius: halo / 2, backgroundColor: color, opacity: 0.08 }]} />
      <View
        style={[
          styles.abs,
          { left: halo * 0.3, top: halo * 0.3, width: halo * 0.4, height: halo * 0.4, borderRadius: halo * 0.2, backgroundColor: color, opacity: 0.18 },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: (halo - spot.size) / 2,
            top: (halo - spot.size) / 2,
            width: spot.size,
            height: spot.size,
            borderRadius: spot.size / 2,
            backgroundColor: '#FFFFFF',
          },
        ]}
      />
    </Animated.View>
  );
}

/** A four-point sparkle (✦ drawn as two thin crossed bars) that pulses and turns slightly. */
function Sparkle({ spot, color, animate }: { spot: Spot; color: string; animate: boolean }) {
  const o = useTwinkle(animate, spot.delay, spot.duration);
  const style = useAnimatedStyle(() => ({
    opacity: 0.3 + o.value * 0.7,
    transform: [{ scale: 0.6 + o.value * 0.5 }, { rotate: `${o.value * 20}deg` }],
  }));
  const s = spot.size;
  const bar = Math.max(1.5, s / 7);
  return (
    <Animated.View style={[{ position: 'absolute', left: spot.left, top: spot.top, width: s, height: s }, style]}>
      <View style={[styles.abs, { left: (s - bar) / 2, top: 0, width: bar, height: s, borderRadius: bar, backgroundColor: color }]} />
      <View style={[styles.abs, { top: (s - bar) / 2, left: 0, height: bar, width: s, borderRadius: bar, backgroundColor: color }]} />
    </Animated.View>
  );
}

type Meteor = { startX: number; startY: number; delay: number; every: number; length: number };

/**
 * Shooting stars: start (fraction of the screen), first delay and repeat period in ms, trail length. Periods
 * are whole cycles and delays land inside a cycle's burst, so meteors never break up the still gaps.
 */
const METEORS: readonly Meteor[] = [
  { startX: 0.85, startY: 0.04, delay: 1200, every: 2 * CYCLE_MS, length: 120 },
  { startX: 0.55, startY: 0.18, delay: CYCLE_MS + 900, every: 3 * CYCLE_MS, length: 90 },
  { startX: 1.05, startY: 0.35, delay: 2 * CYCLE_MS + 1500, every: 4 * CYCLE_MS, length: 140 },
];
/** Travel direction: down and to the left. */
const METEOR_ANGLE = 152;
const METEOR_FLIGHT_MS = 1100;

function ShootingStar({ meteor, color }: { meteor: Meteor; color: string }) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withDelay(
      meteor.delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: METEOR_FLIGHT_MS, easing: Easing.in(Easing.quad) }),
          withDelay(meteor.every - METEOR_FLIGHT_MS, withTiming(0, { duration: 0 })),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(t);
  }, [t, meteor]);
  const travel = Math.max(width, height) * 0.55;
  const rad = (METEOR_ANGLE * Math.PI) / 180;
  const dx = Math.cos(rad) * travel;
  const dy = Math.sin(rad) * travel;
  const style = useAnimatedStyle(() => ({
    // Fade in quickly, out over the last third of the flight; hidden between flights.
    opacity: t.value === 0 ? 0 : Math.min(1, t.value * 6) * Math.min(1, (1 - t.value) * 3),
    transform: [{ translateX: t.value * dx }, { translateY: t.value * dy }, { rotate: `${METEOR_ANGLE}deg` }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: meteor.startX * width - meteor.length,
          top: meteor.startY * height,
          width: meteor.length,
          height: 2,
          transformOrigin: 'right',
        },
        style,
      ]}
    >
      <LinearGradient
        colors={['transparent', color]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 1 }]}
      />
      <View style={[styles.meteorHead, { backgroundColor: '#FFFFFF', shadowColor: color }]} />
    </Animated.View>
  );
}

function StarDots({ tint }: { tint: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 200" preserveAspectRatio="xMidYMid slice">
      {STARS.map((s, i) => (
        <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill={tint} opacity={s.o} />
      ))}
    </Svg>
  );
}

function Stars({ colors, animate }: { colors: Palette; animate: boolean }) {
  const tint = colors.isLight ? colors.textTertiary : '#FFFFFF';
  return (
    <>
      <LinearGradient
        colors={[colors.accentSoft, 'transparent', 'transparent', colors.accentSoft]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      <StarDots tint={tint} />
      {TWINKLERS.map((t, i) => (
        <Twinkle key={i} spot={t} color={i % 3 === 0 ? colors.accent : tint} animate={animate} />
      ))}
    </>
  );
}

/** Night sky: violet-to-indigo depth, haloed stars, four-point sparkles and the odd shooting star. */
function NightSky({ colors, animate }: { colors: Palette; animate: boolean }) {
  const starTint = '#D8E2FF';
  return (
    <>
      <LinearGradient
        colors={['#2A0A5E', 'transparent', colors.surface]}
        locations={[0, 0.55, 1]}
        style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
      />
      <StarDots tint={starTint} />
      {GLOWS.map((g, i) => (
        <GlowStar key={`g${i}`} spot={g} color={i % 2 ? colors.accent : starTint} animate={animate} />
      ))}
      {SPARKLES.map((s, i) => (
        <Sparkle key={`s${i}`} spot={s} color={starTint} animate={animate} />
      ))}
      {animate ? METEORS.map((m, i) => <ShootingStar key={`m${i}`} meteor={m} color={colors.accent} />) : null}
    </>
  );
}

/**
 * Theme decoration behind a screen's content (star skies, a soft accent glow). Render it as the first child of
 * a screen's root view; it draws nothing for themes without a backdrop. Animates only on the focused screen and
 * stays still when the system asks for reduced motion, or with `still` (a copy, such as the status-bar band).
 */
export function Backdrop({ still = false }: { still?: boolean }) {
  const colors = useColors();
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  if (colors.backdrop === 'none') return null;
  const animate = !still && focused && !reduceMotion;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {colors.backdrop === 'stars' ? (
        <Stars colors={colors} animate={animate} />
      ) : colors.backdrop === 'night' ? (
        <NightSky colors={colors} animate={animate} />
      ) : (
        <LinearGradient
          colors={[colors.accentSoft, 'transparent']}
          locations={[0, 0.45]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { position: 'absolute', left: 0, top: 0 },
  meteorHead: {
    position: 'absolute',
    right: -1,
    top: -1,
    width: 4,
    height: 4,
    borderRadius: 2,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
});
