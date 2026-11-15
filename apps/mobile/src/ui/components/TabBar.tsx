import type { MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { create, useStore } from 'zustand';

import { ChromeDock, ChromeSurface, NAV_PILL_HEIGHT } from '../chrome';
import { haptics } from '../haptics';
import { makeStyles, space, TAB_BAR_HEIGHT, useColors } from '../theme';
import { Icon, type IconName } from './Icon';
import { MiniPlayer } from './MiniPlayer';
import { Text } from './Text';

const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  index: { label: 'Home', icon: 'home-outline', iconActive: 'home' },
  search: { label: 'Search', icon: 'search-outline', iconActive: 'search' },
  library: { label: 'Library', icon: 'albums-outline', iconActive: 'albums' },
};

/** Custom bottom tab bar for the tab pager, with the MiniPlayer docked on top. Rendered in-flow so screens never sit under it. */
export function TabBar({ state, emitter, navigateToTab, insets }: MaterialTopTabBarProps) {
  const styles = useStyles();
  const colors = useColors();
  // One tick per tab change, whether it came from a tap or a swipe of the pager.
  const lastIndex = useRef(state.index);
  useEffect(() => {
    if (state.index !== lastIndex.current) haptics.select();
    lastIndex.current = state.index;
  }, [state.index]);
  return (
    <View role="navigation" style={[styles.root, { paddingBottom: insets.bottom }]}>
      <MiniPlayer />
      <View style={styles.row} accessibilityRole="tablist">
        {state.routes.map((route, i) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = i === state.index;
          const color = focused ? colors.text : colors.textTertiary;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              style={styles.tab}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigateToTab(route.key);
              }}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}>
              <Icon name={focused ? tab.iconActive : tab.icon} size={24} color={color} strokeWidth={focused ? 2.6 : 2} />
              <Text variant="micro" color={color} style={styles.label}>
                {tab.label}
              </Text>
              <View style={[styles.dot, focused && styles.dotActive]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Floating navigation

/**
 * The floating pills are drawn over the pager from outside it (glass has to be a sibling of what it
 * blurs), so the navigator hands its state across: `TabBarBridge` sits in the `tabBar` slot and publishes.
 * `position` is the pager's live scroll position (driven natively), so the pill follows the finger
 * mid-swipe instead of waiting for the page to settle.
 */
type Position = Animated.AnimatedInterpolation<number>;
const tabsStore = create<{ names: readonly string[]; keys: readonly string[]; position: Position; webIndex: number; jumpTo: (key: string) => void }>(() => ({
  names: [],
  keys: [],
  position: new Animated.Value(0).interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
  webIndex: 0,
  jumpTo: () => {},
}));

export function TabBarBridge({ state, position, jumpTo }: MaterialTopTabBarProps) {
  const { routes } = state;
  const webIndex = Platform.OS === 'web' ? state.index : 0;
  useEffect(() => {
    tabsStore.setState({ names: routes.map((r) => r.name), keys: routes.map((r) => r.key), position, jumpTo, webIndex });
  }, [routes, position, jumpTo, webIndex]);
  return null;
}

const PILL_PAD = 6;

/** Mini player and navigation as pills floating over the tab screens. */
export function FloatingTabs() {
  return (
    <ChromeDock>
      <MiniPlayer />
      <FloatingTabBar />
    </ChromeDock>
  );
}

function FloatingTabBar() {
  const styles = useStyles();
  const names = useStore(tabsStore, (s) => s.names);
  const keys = useStore(tabsStore, (s) => s.keys);
  const position = useStore(tabsStore, (s) => s.position);
  const jumpTo = useStore(tabsStore, (s) => s.jumpTo);
  const [width, setWidth] = useState(0);
  const slot = names.length > 0 ? (width - PILL_PAD * 2) / names.length : 0;
  // Web mirrors the position into a shared value (see WEB_MOTION).
  const pos = useSharedValue(WEB_MOTION ? tabsStore.getState().webIndex : 0);
  // The tab nearest the pager's position: flips (with a tick) as a swipe crosses the middle, not when it settles.
  const [active, setActive] = useState(() => WEB_MOTION ? tabsStore.getState().webIndex : 0);
  const [webPosition, setWebPosition] = useState(WEB_MOTION ? position : null);
  // The web pager can reach its initial offset before the live listener attaches.
  // Reset only when binding a position; animation frames still control active afterwards.
  if (WEB_MOTION && webPosition !== position) {
    setWebPosition(position);
    setActive(tabsStore.getState().webIndex);
  }
  useEffect(() => {
    if (WEB_MOTION) pos.set(tabsStore.getState().webIndex);
    let last = -1;
    const id = position.addListener(({ value }) => {
      if (WEB_MOTION) pos.set(value);
      const next = Math.round(value);
      if (next === last) return;
      if (last !== -1) haptics.select();
      last = next;
      setActive(next);
    });
    return () => position.removeListener(id);
  }, [position, pos]);
  const motion: Motion = WEB_MOTION ? { kind: 'web', pos } : { kind: 'native', position };
  return (
    <ChromeSurface radius={NAV_PILL_HEIGHT / 2} style={styles.pill}>
      <View style={styles.pillRow} accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {/* JS-driven Animated only notifies listeners of a node some view is bound to; this one keeps it bound. */}
        {WEB_MOTION ? <Animated.View pointerEvents="none" style={[styles.probe, { transform: [{ translateX: position }] }]} /> : null}
        {slot > 0 ? <Highlight motion={motion} slot={slot} count={names.length} /> : null}
        {names.map((name, i) => {
          const tab = TABS[name];
          if (!tab) return null;
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === active }}
              accessibilityLabel={tab.label}
              style={styles.pillTab}
              onPress={() => {
                const key = keys[i];
                if (i !== active && key) jumpTo(key);
              }}>
              <TabFace motion={motion} index={i} tab={tab} />
            </Pressable>
          );
        })}
      </View>
    </ChromeSurface>
  );
}

/**
 * The pill follows the pager position. Native binds it with the native driver, so it runs on the UI
 * thread. react-native-web has no native driver: its `Animated` re-renders every bound view through
 * React on every frame, which stutters mid-swipe. Web copies the position into a Reanimated shared value
 * instead, and Reanimated writes the styles straight to the DOM.
 */
const WEB_MOTION = Platform.OS === 'web';
type Motion = { kind: 'native'; position: Position } | { kind: 'web'; pos: SharedValue<number> };
type Tab = (typeof TABS)[string];

function Highlight({ motion, slot, count }: { motion: Motion; slot: number; count: number }) {
  return motion.kind === 'web' ? <WebHighlight pos={motion.pos} slot={slot} count={count} /> : <NativeHighlight position={motion.position} slot={slot} count={count} />;
}

function TabFace({ motion, index, tab }: { motion: Motion; index: number; tab: Tab }) {
  return motion.kind === 'web' ? <WebTabFace pos={motion.pos} index={index} tab={tab} /> : <NativeTabFace position={motion.position} index={index} tab={tab} />;
}

function NativeHighlight({ position, slot, count }: { position: Position; slot: number; count: number }) {
  const styles = useStyles();
  const x = useMemo(() => {
    const last = Math.max(1, count - 1);
    return position.interpolate({ inputRange: [0, last], outputRange: [0, last * slot], extrapolate: 'clamp' });
  }, [position, slot, count]);
  return <Animated.View pointerEvents="none" style={[styles.highlight, { width: slot, transform: [{ translateX: x }] }]} />;
}

function WebHighlight({ pos, slot, count }: { pos: SharedValue<number>; slot: number; count: number }) {
  const styles = useStyles();
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: Math.min(Math.max(pos.get(), 0), Math.max(1, count - 1)) * slot }] }));
  return <Reanimated.View pointerEvents="none" style={[styles.highlight, { width: slot }, style]} />;
}

/** Icon only until it is the active tab, then its label opens beside it; both track the pager position. */
function NativeTabFace({ position, index, tab }: { position: Position; index: number; tab: Tab }) {
  const [labelWidth, setLabelWidth] = useState(0);
  const { on, off, shift, labelOpacity } = useMemo(() => {
    const p = position.interpolate({ inputRange: [index - 1, index, index + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' });
    return {
      on: p,
      off: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      // Inactive, the icon sits centred and the (invisible) label hangs off its right side.
      shift: p.interpolate({ inputRange: [0, 1], outputRange: [(labelWidth + space.sm) / 2, 0] }),
      labelOpacity: p.interpolate({ inputRange: [LABEL_FROM, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    };
  }, [position, index, labelWidth]);
  return (
    <FaceLayout
      View={Animated.View as FaceView}
      tab={tab}
      group={{ transform: [{ translateX: shift }] }}
      off={{ opacity: off }}
      on={{ opacity: on }}
      label={{ opacity: labelOpacity }}
      onLabelWidth={setLabelWidth}
    />
  );
}

function WebTabFace({ pos, index, tab }: { pos: SharedValue<number>; index: number; tab: Tab }) {
  const labelWidth = useSharedValue(0);
  const near = (v: number) => {
    'worklet';
    return Math.max(0, 1 - Math.abs(v - index));
  };
  const group = useAnimatedStyle(() => ({ transform: [{ translateX: ((1 - near(pos.get())) * (labelWidth.get() + space.sm)) / 2 }] }));
  const off = useAnimatedStyle(() => ({ opacity: 1 - near(pos.get()) }));
  const on = useAnimatedStyle(() => ({ opacity: near(pos.get()) }));
  const label = useAnimatedStyle(() => ({ opacity: interpolate(near(pos.get()), [LABEL_FROM, 1], [0, 1], Extrapolation.CLAMP) }));
  return <FaceLayout View={Reanimated.View as FaceView} tab={tab} group={group} off={off} on={on} label={label} onLabelWidth={(w) => labelWidth.set(w)} />;
}

/** The label starts fading in once the tab is this close to active. */
const LABEL_FROM = 0.35;

/** Either Animated flavour's View; each face passes styles of its own kind, so they are opaque here. */
type AnyStyle = unknown;
type FaceView = ComponentType<{ style?: AnyStyle; onLayout?: (e: LayoutChangeEvent) => void; children?: ReactNode }>;
function FaceLayout({
  View: AView,
  tab,
  group,
  off,
  on,
  label,
  onLabelWidth,
}: {
  View: FaceView;
  tab: Tab;
  group: AnyStyle;
  off: AnyStyle;
  on: AnyStyle;
  label: AnyStyle;
  onLabelWidth: (width: number) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <AView style={[styles.pillGroup, group]}>
      <View style={styles.pillIcon}>
        <AView style={[StyleSheet.absoluteFill, off]}>
          <Icon name={tab.icon} size={24} color={colors.textSecondary} strokeWidth={2} />
        </AView>
        <AView style={[StyleSheet.absoluteFill, on]}>
          <Icon name={tab.iconActive} size={24} color={colors.text} strokeWidth={2.6} />
        </AView>
      </View>
      <AView style={[styles.pillLabel, label]} onLayout={(e) => onLabelWidth(e.nativeEvent.layout.width)}>
        <Text variant="bodyStrong" color={colors.text} numberOfLines={1}>
          {tab.label}
        </Text>
      </AView>
    </AView>
  );
}

const useStyles = makeStyles((colors) => ({
  pill: { height: NAV_PILL_HEIGHT },
  probe: { position: 'absolute', width: 0, height: 0 },
  pillRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: PILL_PAD },
  highlight: {
    position: 'absolute',
    left: PILL_PAD,
    height: NAV_PILL_HEIGHT - PILL_PAD * 2,
    borderRadius: (NAV_PILL_HEIGHT - PILL_PAD * 2) / 2,
    backgroundColor: colors.track,
  },
  pillTab: { flex: 1, height: NAV_PILL_HEIGHT - PILL_PAD * 2, alignItems: 'center', justifyContent: 'center' },
  pillGroup: { flexDirection: 'row', alignItems: 'center' },
  pillIcon: { width: 24, height: 24 },
  pillLabel: { marginLeft: space.sm },
  root: { backgroundColor: colors.bg, paddingTop: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { height: TAB_BAR_HEIGHT, flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { letterSpacing: 0.2, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.accent },
}));
