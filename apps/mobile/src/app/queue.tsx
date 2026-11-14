import { FlashList } from '@shopify/flash-list';
import { memo, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { haptics } from '@/ui/haptics';
import { makeStyles, space, TRACK_ROW_HEIGHT, useColors } from '@/ui/theme';

const ROW_H = TRACK_ROW_HEIGHT;

type DragState = {
  /** Index (within "up next") of the row being dragged, -1 when idle. */
  from: SharedValue<number>;
  dy: SharedValue<number>;
  /** Top of the dragged row relative to the list container, captured on drag start. */
  top: SharedValue<number>;
  /** List container; measured on the UI thread at drag start (never mid-transition). */
  container: AnimatedRef<Animated.View>;
  count: SharedValue<number>;
};

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
  const drag = useMemo<DragState>(() => ({ from, dy, top, container, count }), [from, dy, top, container, count]);

  useEffect(() => {
    count.set(upNext.length);
  }, [count, upNext.length]);

  const [dragging, setDragging] = useState<number | null>(null);

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
      <Animated.View ref={container} style={styles.flex}>
        <FlashList
          data={upNext}
          keyExtractor={(item) => `${item.abs}:${item.track.key}`}
          scrollEnabled={dragging === null}
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
                      <Text variant="bodyStrong" color={colors.accent} numberOfLines={1}>
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
          renderItem={({ item }) => <QueueRow item={item} drag={drag} onDragStart={startDrag} onDragEnd={endDrag} />}
        />
        {ghost ? <Ghost track={ghost.track} drag={drag} /> : null}
      </Animated.View>
    </View>
  );
}

const QueueRow = memo(function QueueRow({
  item,
  drag,
  onDragStart,
  onDragEnd,
}: {
  item: Item;
  drag: DragState;
  onDragStart: (rel: number) => void;
  onDragEnd: (rel: number, to: number) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { track, abs, rel } = item;
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);

  // Rows are recycled by FlashList: reset swipe offset whenever the row shows a different item.
  useLayoutEffect(() => {
    tx.set(0);
  }, [track.key, abs, tx]);

  const remove = () => {
    haptics.tap();
    player.removeFromQueue(abs);
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
      drag.from.set(rel);
      scheduleOnRN(onDragStart, rel);
    },
    onUpdate: (e) => {
      'worklet';
      drag.dy.set(e.translationY);
    },
    onDeactivate: () => {
      'worklet';
      const to = Math.max(0, Math.min(drag.count.get() - 1, rel + Math.round(drag.dy.get() / ROW_H)));
      scheduleOnRN(onDragEnd, rel, to);
    },
  });

  const rowStyle = useAnimatedStyle(() => {
    const from = drag.from.get();
    if (from < 0) return { opacity: 1, transform: [{ translateY: 0 }] };
    if (from === rel) return { opacity: 0, transform: [{ translateY: 0 }] };
    const to = Math.max(0, Math.min(drag.count.get() - 1, from + Math.round(drag.dy.get() / ROW_H)));
    let shift = 0;
    if (from < rel && rel <= to) shift = -ROW_H;
    else if (to <= rel && rel < from) shift = ROW_H;
    return { opacity: 1, transform: [{ translateY: withTiming(shift, { duration: 140 }) }] };
  });
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }] }));
  const underlayStyle = useAnimatedStyle(() => ({ opacity: tx.get() < -4 ? 1 : 0 }));

  return (
    <Animated.View style={[styles.rowWrap, rowStyle]}>
      <Animated.View style={[styles.underlay, underlayStyle]}>
        <Icon name="trash-outline" size={20} color={colors.onAccent} />
        <Text variant="bodyStrong" color={colors.onAccent}>
          Remove
        </Text>
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.rowContent, contentStyle]}>
          <Pressable
            style={styles.rowPress}
            accessibilityRole="button"
            accessibilityLabel={`Play ${track.title} by ${track.artist}`}
            accessibilityActions={[{ name: 'delete', label: 'Remove from queue' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'delete') remove();
            }}
            android_ripple={{ color: colors.ripple }}
            onPress={() => {
              haptics.tap();
              player.jumpTo(abs);
            }}>
            <RowBody track={track} />
          </Pressable>
          <GestureDetector gesture={handle}>
            <View style={styles.handle} accessibilityLabel="Reorder" accessibilityHint="Drag up or down">
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

function Ghost({ track, drag }: { track: AppTrack; drag: DragState }) {
  const styles = useStyles();
  const colors = useColors();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: drag.top.get() + drag.dy.get() }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, style]}>
      <View style={styles.rowPress}>
        <RowBody track={track} />
      </View>
      <View style={styles.handle}>
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
  rowWrap: { height: ROW_H },
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
  rowPress: { flex: 1, height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg },
  handle: { width: 56, height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  ghost: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: ROW_H,
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
