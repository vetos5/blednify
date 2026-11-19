import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  measure,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { player, usePlayer, type AppTrack } from '@/core';
import { Backdrop } from '@/ui/components/Backdrop';
import { Artwork } from '@/ui/components/Artwork';
import { EmptyState } from '@/ui/components/EmptyState';
import { Equalizer } from '@/ui/components/Equalizer';
import { Icon } from '@/ui/components/Icon';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { Text } from '@/ui/components/Text';
import { useWideRedirect } from '@/ui/desktop/redirect';
import { removeFromQueueWithUndo } from '@/ui/actions';
import { haptics } from '@/ui/haptics';
import { useTrackRowHeight } from '@/ui/layout';
import { makeStyles, space, useColors } from '@/ui/theme';
import { spokenLabel } from '@/ui/a11y';

/** Dragging within this many rows of the list's top or bottom edge scrolls it. */
const EDGE_ROWS = 1.25;
/** Auto-scroll speed at the very edge, in px per second. */
const MAX_SCROLL_SPEED = 1100;

type DragState = {
  /** Index (within "up next") of the row being dragged, -1 when idle. */
  from: SharedValue<number>;
  dy: SharedValue<number>;
  /** Top of the dragged row relative to the list container, captured on drag start. */
  top: SharedValue<number>;
  /** List container; measured on the UI thread at drag start (never mid-transition). */
  container: AnimatedRef<Animated.View>;
  count: SharedValue<number>;
  /** Current list scroll offset, and its value when the drag started: the row under the finger moves with the list. */
  scroll: SharedValue<number>;
  scroll0: SharedValue<number>;
  /** Row height at the system font scale (`trackRowHeight`): every row is exactly this tall, the drag maths use it. */
  rowH: SharedValue<number>;
};

/**
 * Queue position (abs) of a row moved with a TalkBack action. Rows are keyed by position, so the moved row remounts
 * and TalkBack focus would drop back to the top of the list; the new row takes the focus back when it mounts.
 */
const a11yFocus = { abs: -1 };

type Item = { track: AppTrack; abs: number; rel: number };

export default function QueueScreen() {
  return useWideRedirect('queue') ? null : <QueueScreenContent />;
}

function QueueScreenContent() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const current = queue[index] ?? null;

  const upNext: Item[] = [];
  for (let i = index + 1; i < queue.length; i++) upNext.push({ track: queue[i], abs: i, rel: i - index - 1 });

  const from = useSharedValue(-1);
  const dy = useSharedValue(0);
  const top = useSharedValue(0);
  const container = useAnimatedRef<Animated.View>();
  const count = useSharedValue(upNext.length);
  const scroll = useSharedValue(0);
  const scroll0 = useSharedValue(0);
  const rowHeight = useTrackRowHeight();
  const rowH = useSharedValue(rowHeight);
  useEffect(() => {
    rowH.set(rowHeight);
  }, [rowH, rowHeight]);
  const drag = useMemo<DragState>(
    () => ({ from, dy, top, container, count, scroll, scroll0, rowH }),
    [from, dy, top, container, count, scroll, scroll0, rowH],
  );
  const listRef = useRef<FlatList<Item>>(null);
  const metrics = useRef({ offset: 0, content: 0, viewport: 0 });


  useEffect(() => {
    count.set(upNext.length);
  }, [count, upNext.length]);

  const [dragging, setDragging] = useState<number | null>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
    scroll.set(contentOffset.y);
  };

  // While a row is held near the top or bottom edge, keep scrolling the list (the list itself is locked to touch).
  useEffect(() => {
    if (dragging === null) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const m = metrics.current;
      const h = rowH.get();
      const EDGE = h * EDGE_ROWS;
      const centre = top.get() + dy.get() + h / 2;
      let speed = 0;
      if (centre < EDGE) speed = -Math.min(1, (EDGE - centre) / EDGE);
      else if (centre > m.viewport - EDGE) speed = Math.min(1, (centre - (m.viewport - EDGE)) / EDGE);
      if (speed !== 0 && m.viewport > 0) {
        const next = Math.max(0, Math.min(Math.max(0, m.content - m.viewport), m.offset + (speed * MAX_SCROLL_SPEED * dt) / 1000));
        if (next !== m.offset) {
          m.offset = next;
          scroll.set(next);
          listRef.current?.scrollToOffset({ offset: next, animated: false });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, top, dy, scroll, rowH]);

  const startDrag = (rel: number) => {
    haptics.press();
    setDragging(rel);
  };

  const endDrag = (rel: number, to: number) => {
    if (to !== rel) {
      haptics.select();
      player.moveInQueue(index + 1 + rel, index + 1 + to);
    }
    setDragging(null);
    // Release row offsets after React has committed the new order to avoid a one-frame flash.
    requestAnimationFrame(() => {
      from.set(-1);
      dy.set(0);
    });
  };

  const ghost = dragging !== null ? upNext[dragging] : undefined;

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScreenHeader title="Queue" backIcon="chevron-down" />
      <Animated.View
        ref={container}
        style={styles.flex}
        onLayout={(e) => {
          metrics.current.viewport = e.nativeEvent.layout.height;
        }}>
        <FlatList
          ref={listRef}
          data={upNext}
          keyExtractor={(item) => `${item.abs}:${item.track.key}`}
          scrollEnabled={dragging === null}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_, h) => {
            metrics.current.content = h;
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          ListHeaderComponent={
            <View>
              {current ? (
                <>
                  <Text variant="micro" style={styles.section}>
                    NOW PLAYING
                  </Text>
                  <View style={styles.nowRow}>
                    <Artwork uri={current.artworkUri} label={current.album || current.title} size={56} recyclingKey={current.key} />
                    <View style={styles.meta}>
                      <Text variant="bodyStrong" color={colors.accentText} numberOfLines={1}>
                        {current.title}
                      </Text>
                      <Text variant="caption" numberOfLines={1}>
                        {current.artist}
                      </Text>
                    </View>
                    <Equalizer playing={isPlaying} size={18} />
                  </View>
                </>
              ) : null}
              {upNext.length > 0 ? (
                <View style={styles.upNextHeader}>
                  <Text variant="micro">UP NEXT · {upNext.length}</Text>
                  <Text variant="caption" style={styles.hint}>
                    Drag ≡ to reorder · swipe left to remove
                  </Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState icon="list-outline" title="Nothing up next" message="Use “Play next” or “Add to queue” from any song’s menu." />
          }
          renderItem={({ item }) => <QueueRow item={item} drag={drag} rowH={rowHeight} onDragStart={startDrag} onDragEnd={endDrag} />}
        />
        {ghost ? <Ghost track={ghost.track} drag={drag} rowH={rowHeight} /> : null}
      </Animated.View>
    </View>
  );
}

const QueueRow = memo(function QueueRow({
  item,
  drag,
  rowH,
  onDragStart,
  onDragEnd,
}: {
  item: Item;
  drag: DragState;
  rowH: number;
  onDragStart: (rel: number) => void;
  onDragEnd: (rel: number, to: number) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { track, abs, rel } = item;
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);
  const pressRef = useRef<ComponentRef<typeof Pressable>>(null);

  // After a TalkBack "Move up/down" this row is the moved song at its new place: give it the focus back.
  useEffect(() => {
    if (a11yFocus.abs !== abs) return;
    a11yFocus.abs = -1;
    const timer = setTimeout(() => {
      const node = findNodeHandle(pressRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 150);
    return () => clearTimeout(timer);
  }, [abs]);

  // Rows are recycled by FlashList: reset swipe offset whenever the row shows a different item.
  useLayoutEffect(() => {
    tx.set(0);
  }, [track.key, abs, tx]);

  const remove = () => {
    haptics.tap();
    removeFromQueueWithUndo(abs);
  };

  const swipe = usePanGesture({
    activeOffsetX: -12,
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      tx.set(Math.min(0, e.translationX));
    },
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled && (tx.get() < -width * 0.35 || e.velocityX < -900)) {
        tx.set(
          withTiming(-width, { duration: 160, easing: Easing.out(Easing.quad) }, (done) => {
            if (done) scheduleOnRN(remove);
          }),
        );
      } else {
        tx.set(withSpring(0, { damping: 20, stiffness: 260 }));
      }
    },
  });

  const handle = usePanGesture({
    minDistance: 1,
    onActivate: (e) => {
      'worklet';
      drag.top.set(e.absoluteY - e.y - (measure(drag.container)?.pageY ?? 0));
      drag.dy.set(0);
      drag.scroll0.set(drag.scroll.get());
      drag.from.set(rel);
      scheduleOnRN(onDragStart, rel);
    },
    onUpdate: (e) => {
      'worklet';
      drag.dy.set(e.translationY);
    },
    onDeactivate: () => {
      'worklet';
      const to = Math.max(0, Math.min(drag.count.get() - 1, rel + Math.round((drag.dy.get() + drag.scroll.get() - drag.scroll0.get()) / drag.rowH.get())));
      scheduleOnRN(onDragEnd, rel, to);
    },
  });

  const rowStyle = useAnimatedStyle(() => {
    const from = drag.from.get();
    if (from < 0) return { opacity: 1, transform: [{ translateY: 0 }] };
    if (from === rel) return { opacity: 0, transform: [{ translateY: 0 }] };
    const h = drag.rowH.get();
    const to = Math.max(0, Math.min(drag.count.get() - 1, from + Math.round((drag.dy.get() + drag.scroll.get() - drag.scroll0.get()) / h)));
    let shift = 0;
    if (from < rel && rel <= to) shift = -h;
    else if (to <= rel && rel < from) shift = h;
    return { opacity: 1, transform: [{ translateY: withTiming(shift, { duration: 140 }) }] };
  });
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }] }));
  const underlayStyle = useAnimatedStyle(() => ({ opacity: tx.get() < -4 ? 1 : 0 }));

  return (
    <Animated.View style={[{ height: rowH }, rowStyle]}>
      <Animated.View style={[styles.underlay, underlayStyle]}>
        <Icon name="trash-outline" size={20} color={colors.onAccent} />
        <Text variant="bodyStrong" color={colors.onAccent}>
          Remove
        </Text>
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.rowContent, contentStyle]}>
          <Pressable
            ref={pressRef}
            style={[styles.rowPress, { height: rowH }]}
            accessibilityRole="button"
            accessibilityLabel={spokenLabel(`Play ${track.title} by ${track.artist}`)}
            // Dragging the handle has no screen-reader equivalent, so moving is offered as actions too.
            accessibilityActions={[
              { name: 'delete', label: 'Remove from queue' },
              { name: 'moveUp', label: 'Move up' },
              { name: 'moveDown', label: 'Move down' },
            ]}
            onAccessibilityAction={(e) => {
              const action = e.nativeEvent.actionName;
              if (action === 'delete') remove();
              else if (action === 'moveUp' && rel > 0) {
                a11yFocus.abs = abs - 1;
                player.moveInQueue(abs, abs - 1);
                AccessibilityInfo.announceForAccessibility(`${track.title} moved to position ${rel} in Up next`);
              } else if (action === 'moveDown' && rel < drag.count.get() - 1) {
                a11yFocus.abs = abs + 1;
                player.moveInQueue(abs, abs + 1);
                AccessibilityInfo.announceForAccessibility(`${track.title} moved to position ${rel + 2} in Up next`);
              }
            }}
            android_ripple={{ color: colors.ripple }}
            onPress={() => {
              haptics.tap();
              player.jumpTo(abs);
            }}>
            <RowBody track={track} />
          </Pressable>
          <GestureDetector gesture={handle}>
            <View style={[styles.handle, { height: rowH }]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
              <Icon name="reorder-three" size={24} color={colors.textSecondary} />
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

function RowBody({ track }: { track: AppTrack }) {
  const styles = useStyles();
  return (
    <>
      <Artwork uri={track.artworkUri} label={track.album || track.title} size={44} recyclingKey={track.key} />
      <View style={styles.meta}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
    </>
  );
}

function Ghost({ track, drag, rowH }: { track: AppTrack; drag: DragState; rowH: number }) {
  const styles = useStyles();
  const colors = useColors();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: drag.top.get() + drag.dy.get() }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, { height: rowH }, style]}>
      <View style={[styles.rowPress, { height: rowH }]}>
        <RowBody track={track} />
      </View>
      <View style={[styles.handle, { height: rowH }]}>
        <Icon name="reorder-three" size={24} color={colors.text} />
      </View>
    </Animated.View>
  );
}


const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  section: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg },
  upNextHeader: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: 2 },
  hint: { fontSize: 12 },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  underlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingRight: space.xl,
    backgroundColor: colors.accent,
  },
  rowContent: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg },
  rowPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg },
  handle: { width: 56, alignItems: 'center', justifyContent: 'center' },
  ghost: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    shadowColor: colors.black,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
}));
