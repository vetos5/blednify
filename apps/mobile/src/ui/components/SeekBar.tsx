import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { formatDuration, onProgress, player, useProgressSeconds } from '@/core';

import { haptics } from '../haptics';
import { makeStyles, space, useColors } from '../theme';
import { Text } from './Text';

const TRACK_H = 4;
const THUMB = 14;

function clamp01(v: number) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Seek slider. Scrubs locally on the UI thread and only seeks on release.
 * The thumb follows playback through a store subscription on the UI thread; React only re-renders the
 * time labels, once a second.
 */
export function SeekBar({ fallbackDurationMs }: { fallbackDurationMs: number }) {
  const styles = useStyles();
  const colors = useColors();
  const { positionSec, durationMs: liveDuration } = useProgressSeconds();
  const positionMs = positionSec * 1000;
  const durationMs = liveDuration > 0 ? liveDuration : fallbackDurationMs;

  const width = useSharedValue(0);
  const ratio = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const lastSec = useSharedValue(-1);
  const duration = useSharedValue(durationMs);
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  useEffect(() => {
    duration.set(durationMs);
  }, [durationMs, duration]);

  // Follow playback unless the user is scrubbing. Core holds `positionMs` at a seek target until the
  // native player arrives there, so neither the thumb nor the time label bounces back while it settles.
  useEffect(() => {
    if (scrubMs !== null) return;
    return onProgress((p) => {
      const r = durationMs > 0 ? clamp01(p.positionMs / durationMs) : 0;
      // Web worklets run on JS: update on the playback tick instead of keeping a frame loop alive.
      ratio.set(Platform.OS === 'web' || Math.abs(ratio.get() - r) > 0.02 ? r : withTiming(r, { duration: 260, easing: Easing.linear }));
    });
  }, [durationMs, scrubMs, ratio]);

  const commit = (r: number) => {
    player.seekTo(Math.round(r * durationMs));
    setScrubMs(null);
    haptics.select();
  };

  const updateFromX = (x: number) => {
    'worklet';
    ratio.set(clamp01(x / Math.max(1, width.get())));
    const sec = Math.floor((ratio.get() * duration.get()) / 1000);
    if (sec !== lastSec.get()) {
      lastSec.set(sec);
      scheduleOnRN(setScrubMs, sec * 1000);
    }
  };

  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    failOffsetY: [-24, 24],
    hitSlop: { vertical: 18 },
    onActivate: (e) => {
      'worklet';
      scrubbing.set(true);
      lastSec.set(-1);
      updateFromX(e.x);
    },
    onUpdate: (e) => {
      'worklet';
      updateFromX(e.x);
    },
    onDeactivate: (e) => {
      'worklet';
      scrubbing.set(false);
      if (e.canceled) scheduleOnRN(setScrubMs, null);
      else scheduleOnRN(commit, ratio.get());
    },
  });

  const tap = useTapGesture({
    hitSlop: { vertical: 18 },
    onDeactivate: (e) => {
      'worklet';
      if (e.canceled) return;
      ratio.set(clamp01(e.x / Math.max(1, width.get())));
      scheduleOnRN(commit, ratio.get());
    },
  });

  const gesture = useCompetingGestures(pan, tap);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: ratio.get() }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ratio.get() * width.get() - THUMB / 2 }, { scale: withTiming(scrubbing.get() ? 1.45 : 1, { duration: 140 }) }],
  }));
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: withTiming(scrubbing.get() ? 1.5 : 1, { duration: 140 }) }],
  }));

  const shownMs = scrubMs ?? positionMs;
  const remaining = Math.max(0, durationMs - shownMs);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.hit}
          onLayout={(e) => {
            width.set(e.nativeEvent.layout.width);
          }}
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          // aria-value* rather than accessibilityValue: react-native-web drops the latter, leaving a slider with no value.
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(shownMs / 1000)}
          aria-valuetext={formatDuration(shownMs)}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const delta = e.nativeEvent.actionName === 'increment' ? 10_000 : -10_000;
            player.seekTo(Math.min(durationMs, Math.max(0, positionMs + delta)));
          }}>
          <Animated.View style={[styles.track, trackStyle]}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </Animated.View>
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Text variant="mono" color={scrubMs !== null ? colors.text : colors.textSecondary}>
          {formatDuration(shownMs)}
        </Text>
        <Text variant="mono">-{formatDuration(remaining)}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  hit: { height: 28, justifyContent: 'center' },
  track: { height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: '100%', width: '100%', backgroundColor: colors.text, transformOrigin: 'left' },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
    shadowColor: colors.black,
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
}));
