import { memo, useState } from 'react';
import { View } from 'react-native';

import { contextMenu } from '../desktop/web';
import type { SheetAnchor } from '../overlay';
import { makeStyles, radius, space, useColors } from '../theme';
import { Icon } from './Icon';
import { Artwork } from './Artwork';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { spokenLabel } from '../a11y';

export type AlbumCardProps = {
  title: string;
  subtitle?: string;
  artworkUri: string | null;
  /** Fixed width for rails; omit inside grids to fill the column. */
  width?: number;
  round?: boolean;
  /**
   * A song rather than an album or artist: tapping plays it instead of opening a page, so the cover carries a small
   * play badge and the spoken label starts with "Play", which tells song cards apart from album cards in a rail.
   */
  song?: boolean;
  recyclingKey?: string;
  onPress: () => void;
  /** Long-press, or right-click in the wide layout (with the cursor position). */
  onLongPress?: (anchor?: SheetAnchor) => void;
};

function AlbumCardImpl({ title, subtitle, artworkUri, width, round, song, recyclingKey, onPress, onLongPress }: AlbumCardProps) {
  const styles = useStyles();
  const colors = useColors();
  const label = subtitle ? `${title}, ${subtitle}` : title;
  const [hovered, setHovered] = useState(false);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={spokenLabel(song ? `Play ${label}` : label)}
      accessibilityHint={song && onLongPress ? 'Long press for more options' : undefined}
      onPress={onPress}
      onLongPress={onLongPress ? () => onLongPress() : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...contextMenu(onLongPress)}
      style={[styles.card, width !== undefined ? { width } : styles.flex]}>
      <View style={[styles.art, round && styles.round, hovered && styles.artHover]}>
        <Artwork uri={artworkUri} label={title} size={width} round={round} radius={radius.md} recyclingKey={recyclingKey} />
        {song ? (
          <View style={styles.badge}>
            <Icon name="play" size={16} color={colors.onAccent} />
          </View>
        ) : null}
      </View>
      <View style={[styles.meta, round && styles.center]}>
        <Text variant="bodyStrong" numberOfLines={1} style={round && styles.centerText}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1} style={round && styles.centerText}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

export const AlbumCard = memo(AlbumCardImpl);

const useStyles = makeStyles((colors) => ({
  card: { gap: space.sm },
  // Web hover: the cover lifts a little (transition is a no-op on native, where hover never fires).
  art: { borderRadius: radius.md, transitionProperty: 'transform, box-shadow', transitionDuration: '180ms' } as object,
  round: { borderRadius: 999 },
  artHover: {
    transform: [{ translateY: -3 }],
    shadowColor: colors.black,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  badge: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
    backgroundColor: colors.accent,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  flex: { flex: 1 },
  meta: { gap: 2 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
}));
