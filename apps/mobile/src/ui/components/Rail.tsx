import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { useGutter, useIsWide } from '../layout';
import { makeStyles, space } from '../theme';
import { IconButton } from './IconButton';
import { SectionHeader } from './SectionHeader';

export const RAIL_CARD_WIDTH = 148;
const WIDE_RAIL_CARD_WIDTH = 176;

/** Card width for rails: larger covers in the wide layout. */
export function useRailCardWidth(): number {
  return useIsWide() ? WIDE_RAIL_CARD_WIDTH : RAIL_CARD_WIDTH;
}

/**
 * Titled horizontal FlashList rail. In the wide layout it gets previous / next page buttons, since a mouse
 * wheel scrolls vertically.
 */
export function Rail<T>({
  title,
  data,
  renderItem,
  keyExtractor,
  actionLabel,
  onAction,
}: {
  title: string;
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  const wide = useIsWide();
  const gutter = useGutter();
  // Only the desktop arrows consume scroll position. Phone rails (native and web) scroll without re-rendering
  // the whole FlashList on every scroll event.
  const trackScroll = wide;
  const list = useRef<FlashListRef<T>>(null);
  const [scroll, setScroll] = useState({ x: 0, max: 0, viewport: 0 });
  if (data.length === 0) return null;

  const page = (dir: 1 | -1) => {
    const step = Math.max(200, scroll.viewport - gutter * 2);
    list.current?.scrollToOffset({ offset: Math.max(0, Math.min(scroll.max, scroll.x + dir * step)), animated: true });
  };
  const arrows =
    wide && scroll.max > 4 ? (
      <View style={styles.arrows}>
        <IconButton icon="chevron-back" label={`Scroll ${title} back`} size={18} diameter={30} variant="filled" disabled={scroll.x <= 4} onPress={() => page(-1)} />
        <IconButton
          icon="chevron-forward"
          label={`Scroll ${title} forward`}
          size={18}
          diameter={30}
          variant="filled"
          disabled={scroll.x >= scroll.max - 4}
          onPress={() => page(1)}
        />
      </View>
    ) : null;

  return (
    <View style={styles.section}>
      <SectionHeader title={title} actionLabel={actionLabel} onAction={onAction} extra={arrows} />
      <FlashList
        ref={list}
        horizontal
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter }}
        ItemSeparatorComponent={Gap}
        scrollEventThrottle={64}
        onScroll={trackScroll ? (e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          setScroll({ x: contentOffset.x, max: contentSize.width - layoutMeasurement.width, viewport: layoutMeasurement.width });
        } : undefined}
        onContentSizeChange={trackScroll ? (w) => setScroll((s) => ({ ...s, max: w - s.viewport })) : undefined}
        onLayout={trackScroll ? (e) => {
          const viewport = e.nativeEvent.layout.width;
          setScroll((s) => ({ ...s, viewport, max: s.max + s.viewport - viewport }));
        } : undefined}
      />
    </View>
  );
}

function Gap() {
  const styles = useStyles();
  const wide = useIsWide();
  return <View style={wide ? styles.gapWide : styles.gap} />;
}

const useStyles = makeStyles(() => ({
  section: { marginBottom: space.xxl },
  gap: { width: space.md },
  gapWide: { width: space.lg + 4 },
  arrows: { flexDirection: 'row', gap: space.sm },
}));
