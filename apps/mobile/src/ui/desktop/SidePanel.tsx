import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { player, usePlayer, type AppTrack } from '@/core';

import { spokenLabel } from '../a11y';
import { removeFromQueueWithUndo } from '../actions';
import { Artwork } from '../components/Artwork';
import { EmptyState } from '../components/EmptyState';
import { Equalizer } from '../components/Equalizer';
import { Icon } from '../components/Icon';
import { Text } from '../components/Text';
import { openTrackActions } from '../components/TrackActions';
import { PANEL_WIDTH } from '../layout';
import { makeStyles, radius, space, useColors } from '../theme';
import { LyricsView } from './LyricsView';
import { setPanel, useDesk, type PanelKind } from './store';
import { Tip } from './Tip';
import { Pressable } from './web';

/** Right-hand panel of the wide layout: Up next or lyrics, beside whatever page is open. */
export function SidePanel({ overlay }: { overlay: boolean }) {
  const styles = useStyles();
  const panel = useDesk((s) => s.panel);
  if (!panel) return null;
  return (
    <View style={[styles.root, overlay && styles.overlay]} accessibilityRole="complementary" accessibilityLabel={TITLES[panel]}>
      <Header panel={panel} />
      {panel === 'queue' ? <QueuePanel /> : <LyricsPanel />}
    </View>
  );
}

const TITLES: Record<PanelKind, string> = { queue: 'Queue', lyrics: 'Lyrics' };

function Header({ panel }: { panel: PanelKind }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.header}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['queue', 'lyrics'] as const).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="tab"
            accessibilityState={{ selected: p === panel }}
            onPress={() => setPanel(p)}
            style={({ hovered }) => [styles.tab, p === panel && styles.tabActive, hovered && p !== panel && styles.hover]}>
            <Text variant="bodyStrong" color={p === panel ? colors.text : colors.textSecondary} style={styles.tabText}>
              {TITLES[p]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Tip label="Close" shortcut="Esc" side="bottom">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close panel"
          onPress={() => setPanel(null)}
          style={({ hovered }) => [styles.close, hovered && styles.hover]}>
          <Icon name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </Tip>
    </View>
  );
}

function LyricsPanel() {
  const current = usePlayer((s) => s.current);
  if (!current) {
    return <EmptyState icon="musical-notes-outline" title="Nothing playing" message="Play a song to see its lyrics here." />;
  }
  return <LyricsView track={current} size="panel" />;
}

const ROW_H = 56;
/** Long queues: render this many upcoming songs; the rest stay in the queue. */
const MAX_ROWS = 200;

type Drag = { from: number; dy: number };

function QueuePanel() {
  const styles = useStyles();
  const colors = useColors();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const current = queue[index] ?? null;
  const upNext = queue.slice(index + 1, index + 1 + MAX_ROWS);
  const more = queue.length - (index + 1) - upNext.length;
  const [drag, setDrag] = useState<Drag | null>(null);
  const startY = useRef(0);

  const target = drag ? Math.max(0, Math.min(upNext.length - 1, drag.from + Math.round(drag.dy / ROW_H))) : -1;
  const shiftFor = (rel: number) => {
    if (!drag || rel === drag.from) return 0;
    if (drag.from < rel && rel <= target) return -ROW_H;
    if (target <= rel && rel < drag.from) return ROW_H;
    return 0;
  };

  const dragRef = useRef<Drag | null>(null);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const handleProps = (rel: number) =>
    ({
      onPointerDown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        startY.current = e.clientY;
        update({ from: rel, dy: 0 });
      },
      onPointerMove: (e: PointerEvent) => {
        if (dragRef.current?.from === rel) update({ from: rel, dy: e.clientY - startY.current });
      },
      onPointerUp: () => {
        const d = dragRef.current;
        update(null);
        if (!d || d.from !== rel) return;
        const to = Math.max(0, Math.min(upNext.length - 1, d.from + Math.round(d.dy / ROW_H)));
        if (to !== d.from) player.moveInQueue(index + 1 + d.from, index + 1 + to);
      },
      onPointerCancel: () => update(null),
      // The handle only drags: don't let the release click play the row.
      onClick: (e: MouseEvent) => e.stopPropagation(),
    }) as object;

  if (!current) {
    return <EmptyState icon="list-outline" title="Queue is empty" message="Play an album, a playlist or any song to fill it." />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.queue} scrollEnabled={!drag}>
      <Text variant="micro" color={colors.textTertiary} style={styles.section}>
        NOW PLAYING
      </Text>
      <View style={[styles.row, styles.nowRow]}>
        <Artwork uri={current.artworkUri} label={current.album || current.title} size={40} recyclingKey={current.key} />
        <View style={styles.meta}>
          <Text variant="bodyStrong" color={colors.accent} numberOfLines={1} style={styles.title}>
            {current.title}
          </Text>
          <Text variant="caption" numberOfLines={1} style={styles.sub}>
            {current.artist}
          </Text>
        </View>
        <Equalizer playing={isPlaying} size={16} />
      </View>

      <Text variant="micro" color={colors.textTertiary} style={styles.section}>
        {upNext.length ? `NEXT UP · ${queue.length - index - 1}` : 'NEXT UP'}
      </Text>
      {upNext.length === 0 ? (
        <Text variant="caption" style={styles.emptyNote}>
          Right-click a song and choose “Play next” or “Add to queue”.
        </Text>
      ) : null}
      {upNext.map((track, rel) => (
        <QueueRow
          key={`${index + 1 + rel}:${track.key}`}
          track={track}
          abs={index + 1 + rel}
          dragging={drag?.from === rel}
          offset={drag?.from === rel ? drag.dy : shiftFor(rel)}
          handle={handleProps(rel)}
        />
      ))}
      {more > 0 ? (
        <Text variant="caption" style={styles.emptyNote}>
          + {more} more
        </Text>
      ) : null}
    </ScrollView>
  );
}

function QueueRow({ track, abs, dragging, offset, handle }: { track: AppTrack; abs: number; dragging: boolean; offset: number; handle: object }) {
  const styles = useStyles();
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  return (
    <View style={[styles.rowWrap, { transform: [{ translateY: offset }] }, dragging ? styles.dragging : styles.settle]}>
      {/* The remove button is a sibling of the row's play button, not nested in it: a screen reader on web can't
          reach a button inside a button. Hover is tracked on this wrapper so the pointer can cross between them. */}
      <View
        style={[styles.row, (hovered || dragging) && styles.hover]}
        {...({
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          onContextMenu: (e: MouseEvent) => {
            e.preventDefault();
            openTrackActions(track, { anchor: { x: e.clientX, y: e.clientY } });
          },
        } as object)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={spokenLabel(`Play ${track.title} by ${track.artist}`)}
          onPress={() => player.jumpTo(abs)}
          style={styles.rowMain}>
          <View style={styles.handle} {...handle} accessibilityLabel="Drag to reorder">
            {hovered || dragging ? (
              <Icon name="reorder-three" size={16} color={colors.textSecondary} />
            ) : (
              <Artwork uri={track.artworkUri} label={track.album || track.title} size={40} recyclingKey={track.key} />
            )}
          </View>
          <View style={styles.meta}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.title}>
              {track.title}
            </Text>
            <Text variant="caption" numberOfLines={1} style={styles.sub}>
              {track.artist}
            </Text>
          </View>
        </Pressable>
        {hovered && !dragging ? (
          <Tip label="Remove from queue" side="bottom">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove from queue"
              onPress={() => removeFromQueueWithUndo(abs)}
              style={({ hovered: h }) => [styles.remove, h && styles.hover]}>
              <Icon name="close" size={16} color={colors.textSecondary} />
            </Pressable>
          </Tip>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    width: PANEL_WIDTH,
    backgroundColor: colors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    shadowColor: colors.black,
    shadowOpacity: 0.45,
    shadowRadius: 32,
    shadowOffset: { width: -8, height: 0 },
  },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  tabs: { flex: 1, flexDirection: 'row', gap: space.xs },
  tab: { height: 32, paddingHorizontal: space.md, borderRadius: radius.pill, justifyContent: 'center' },
  tabActive: { backgroundColor: colors.surface3 },
  tabText: { fontSize: 14 },
  hover: { backgroundColor: colors.pressed },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  queue: { paddingHorizontal: space.sm, paddingBottom: space.xl },
  section: { paddingHorizontal: space.sm, paddingTop: space.md, paddingBottom: space.sm },
  rowWrap: { height: ROW_H },
  settle: { transitionProperty: 'transform', transitionDuration: '140ms' } as object,
  dragging: { zIndex: 5, backgroundColor: colors.surface2, borderRadius: radius.sm, shadowColor: colors.black, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, borderRadius: radius.sm },
  rowMain: { flex: 1, minWidth: 0, height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: space.md },
  nowRow: { marginBottom: space.xs },
  handle: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', cursor: 'grab', touchAction: 'none' } as object,
  meta: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 14, lineHeight: 18 },
  sub: { fontSize: 12, lineHeight: 16 },
  remove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emptyNote: { paddingHorizontal: space.sm, paddingVertical: space.sm, color: colors.textTertiary },
}));
