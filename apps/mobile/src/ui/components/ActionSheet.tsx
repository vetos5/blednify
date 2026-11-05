import { createContext, use, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, ScrollView, usePanGesture, type PanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '../haptics';
import { closeSheet, useOverlay } from '../overlay';
import { colors, radius, space } from '../theme';
import { Artwork } from './Artwork';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { TopLayer } from './TopLayer';

const OPEN_SPRING = { damping: 26, stiffness: 300, mass: 0.9 };

/** Lets scrollable sheet content cooperate with the drag-to-dismiss pan (see `SheetScrollView`). */
const SheetGesture = createContext<{ pan: PanGesture; scrollY: SharedValue<number> } | null>(null);

/**
 * Global bottom sheet host (mounted once in the root layout). Content is pushed with `showSheet(<…/>)`.
 * Built on Reanimated + Gesture Handler: drag down / tap scrim / back button to dismiss.
 */
export function ActionSheetHost() {
  const sheet = useOverlay((s) => s.sheet);
  const [rendered, setRendered] = useState(sheet);
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(screenH);
  const keyboard = useSharedValue(0);
  /** Scroll offset of the sheet's inner `SheetScrollView` (0 when there is none). */
  const scrollY = useSharedValue(0);
  /** The current drag started while the inner list was scrolled, so it belongs to the list. */
  const listDrag = useSharedValue(false);

  // Mount new content immediately; keep old content mounted while animating out.
  if (sheet && sheet !== rendered) setRendered(sheet);

  useEffect(() => {
    if (sheet) {
      offset.set(withSpring(0, OPEN_SPRING));
    } else {
      offset.set(
        withTiming(screenH, { duration: 220, easing: Easing.in(Easing.quad) }, (done) => {
          if (done) scheduleOnRN(setRendered, null);
        }),
      );
    }
  }, [sheet, offset, screenH]);

  useEffect(() => {
    if (!sheet) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [sheet]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, (e) => {
      keyboard.set(withTiming(e.endCoordinates.height, { duration: e.duration || 220 }));
    });
    const b = Keyboard.addListener(hideEvt, (e) => {
      keyboard.set(withTiming(0, { duration: e.duration || 200 }));
    });
    return () => {
      a.remove();
      b.remove();
    };
  }, [keyboard]);

  const pan = usePanGesture({
    activeOffsetY: 8,
    failOffsetX: [-24, 24],
    onActivate: () => {
      'worklet';
      listDrag.set(scrollY.get() > 0);
    },
    onUpdate: (e) => {
      'worklet';
      if (!listDrag.get()) offset.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (listDrag.get()) return;
      if (e.translationY > 110 || e.velocityY > 900) {
        scheduleOnRN(closeSheet);
      } else {
        offset.set(withSpring(0, OPEN_SPRING));
      }
    },
  });

  // The keyboard lift is a layout prop, not a transform: on Android touches are hit-tested against the
  // un-transformed layout, so a translated sheet left its buttons unreachable behind the keyboard.
  const sheetStyle = useAnimatedStyle(() => ({
    bottom: keyboard.get(),
    transform: [{ translateY: offset.get() }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.get(), [0, screenH * 0.5], [1, 0], 'clamp'),
  }));

  if (!rendered) return null;

  return (
    <TopLayer gestures>
      <View style={StyleSheet.absoluteFill} pointerEvents={sheet ? 'auto' : 'none'}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space.sm, maxHeight: screenH * 0.86 }, sheetStyle]}>
            <View style={styles.grabber} />
            <SheetGesture value={{ pan, scrollY }}>
              <View key={rendered.id}>{rendered.content}</View>
            </SheetGesture>
          </Animated.View>
        </GestureDetector>
      </View>
    </TopLayer>
  );
}

/**
 * Scrollable sheet content. Runs alongside the dismiss pan: a downward drag scrolls the list while it is
 * scrolled, and only drags the sheet once the list is at the top.
 */
export function SheetScrollView(props: ComponentProps<typeof ScrollView>) {
  const ctx = use(SheetGesture);
  const scrollY = ctx?.scrollY;
  useEffect(() => {
    scrollY?.set(0);
    return () => scrollY?.set(0);
  }, [scrollY]);
  return (
    <ScrollView
      bounces={false}
      overScrollMode="never"
      {...props}
      simultaneousWith={ctx?.pan}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrollY?.set(e.nativeEvent.contentOffset.y);
        props.onScroll?.(e);
      }}
    />
  );
}

export function SheetHeader({
  title,
  subtitle,
  artworkUri,
  artworkLabel,
}: {
  title: string;
  subtitle?: string;
  artworkUri?: string | null;
  artworkLabel?: string;
}) {
  return (
    <View style={styles.header}>
      {artworkUri !== undefined ? <Artwork uri={artworkUri} label={artworkLabel ?? title} size={48} /> : null}
      <View style={styles.headerMeta}>
        <Text variant="subheading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export type SheetActionProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Keep the sheet open after pressing (e.g. to switch to a sub-view). */
  keepOpen?: boolean;
  trailing?: ReactNode;
};

export function SheetAction({ icon, label, onPress, destructive, keepOpen, trailing }: SheetActionProps) {
  const color = destructive ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      onPress={() => {
        haptics.select();
        if (!keepOpen) closeSheet();
        onPress();
      }}>
      <Icon name={icon} size={22} color={destructive ? colors.danger : colors.textSecondary} />
      <Text variant="body" color={color} style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingTop: space.sm,
    overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.surface3, marginBottom: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: space.xs,
  },
  headerMeta: { flex: 1, minWidth: 0, gap: 2 },
  action: { height: 52, flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.xl },
  actionPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  actionLabel: { flex: 1 },
});
