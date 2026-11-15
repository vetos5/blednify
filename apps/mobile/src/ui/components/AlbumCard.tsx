import { memo, useState } from 'react';
import { View } from 'react-native';

import { contextMenu } from '../desktop/web';
import type { SheetAnchor } from '../overlay';
import { makeStyles, radius, space } from '../theme';
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
  recyclingKey?: string;
  onPress: () => void;
  /** Long-press, or right-click in the wide layout (with the cursor position). */
  onLongPress?: (anchor?: SheetAnchor) => void;
};

function AlbumCardImpl({ title, subtitle, artworkUri, width, round, recyclingKey, onPress, onLongPress }: AlbumCardProps) {
  const styles = useStyles();
  const [hovered, setHovered] = useState(false);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={spokenLabel(subtitle ? `${title}, ${subtitle}` : title)}
      onPress={onPress}
      onLongPress={onLongPress ? () => onLongPress() : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...contextMenu(onLongPress)}
      style={[styles.card, width !== undefined ? { width } : styles.flex]}>
      <View style={[styles.art, round && styles.round, hovered && styles.artHover]}>
        <Artwork uri={artworkUri} label={title} size={width} round={round} radius={radius.md} recyclingKey={recyclingKey} />
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
  flex: { flex: 1 },
  meta: { gap: 2 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
}));
