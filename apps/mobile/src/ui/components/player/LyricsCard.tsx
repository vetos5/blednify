import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';

import {
  useActiveLyric,
  type AppTrack,
  type LyricLine,
  type Lyrics,
} from '@/core';
import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/Text';
import { haptics } from '@/ui/haptics';
import { nav } from '@/ui/nav';
import { gradientFor, makeStyles, radius, space, useColors } from '@/ui/theme';
import { spokenLabel } from '../../a11y';

export function LyricsCard({ track, lyrics }: { track: AppTrack; lyrics: Lyrics }) {
  const styles = useStyles();
  const colors = useColors();
  const [tint] = gradientFor(track.album || track.title);
  const isSynced = (lyrics.synced?.length ?? 0) > 0;

  const openLyrics = () => {
    haptics.tap();
    nav.lyrics();
  };

  return (
    <Pressable
      onPress={openLyrics}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel('Lyrics, tap to expand')}
      accessibilityHint="Opens full lyrics view"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tint },
        pressed && styles.pressed,
      ]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lyrics</Text>
        <View style={styles.expandButton}>
          <Icon name="expand-outline" size={16} color={colors.white} />
        </View>
      </View>

      <View style={styles.content}>
        {isSynced ? (
          <SyncedPreview key={track.key} lines={lyrics.synced!} />
        ) : (
          <PlainPreview key={track.key} text={lyrics.plain ?? ''} />
        )}
      </View>
    </Pressable>
  );
}

function SyncedPreview({ lines }: { lines: LyricLine[] }) {
  const styles = useStyles();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const ys = useRef<number[]>([]);
  const laidOut = useRef(0);
  const [ready, setReady] = useState(false);
  const placed = useRef(false);
  const active = useActiveLyric(lines);

  useEffect(() => {
    const y = ys.current[active];
    if (y === undefined) return;
    // First placement jumps (mid-song open or skip); later lines glide.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 48), animated: placed.current });
    placed.current = true;
  }, [active, ready]);

  const measure = (i: number, y: number) => {
    if (ys.current[i] === undefined && ++laidOut.current === lines.length) setReady(true);
    ys.current[i] = y;
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      pointerEvents="none">
      {lines.map((l, i) => (
        <PreviewLine
          key={i}
          index={i}
          text={l.text}
          state={i === active ? 'active' : i < active ? 'past' : 'future'}
          onMeasure={measure}
        />
      ))}
    </ScrollView>
  );
}

type LineState = 'past' | 'active' | 'future';

const PreviewLine = memo(function PreviewLine({
  index,
  text,
  state,
  onMeasure,
}: {
  index: number;
  text: string;
  state: LineState;
  onMeasure: (i: number, y: number) => void;
}) {
  const styles = useStyles();
  const stateStyle = state === 'active' ? styles.lineActive : state === 'past' ? styles.linePast : styles.lineFuture;
  return (
    <View onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y)} style={styles.lineWrap}>
      <Text style={[styles.lineText, stateStyle, !text && styles.gapText]} numberOfLines={2}>
        {text || '♪'}
      </Text>
    </View>
  );
});

function PlainPreview({ text }: { text: string }) {
  const styles = useStyles();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <View style={styles.plainContainer} pointerEvents="none">
      {lines.map((line, i) => (
        <Text key={i} style={styles.plainLineText} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: radius.xl,
    padding: space.lg,
    overflow: 'hidden',
    height: 260,
  },
  pressed: {
    opacity: 0.92,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  expandButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: space.xs,
    gap: space.sm,
  },
  lineWrap: {
    justifyContent: 'center',
  },
  lineText: {
    fontSize: 18,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  lineActive: {
    color: colors.white,
    fontWeight: '800',
    opacity: 1,
  },
  linePast: {
    color: colors.white,
    fontWeight: '700',
    opacity: 0.6,
  },
  lineFuture: {
    color: colors.white,
    fontWeight: '600',
    opacity: 0.35,
  },
  gapText: {
    fontSize: 18,
    fontWeight: '800',
  },
  plainContainer: {
    gap: space.sm,
    paddingVertical: space.xs,
  },
  plainLineText: {
    color: colors.white,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    opacity: 0.9,
  },
}));
