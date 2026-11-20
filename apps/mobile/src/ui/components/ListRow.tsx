import { memo, type ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { contextMenu, Pressable } from '../desktop/web';
import { useIsWide } from '../layout';
import type { SheetAnchor } from '../overlay';
import { makeStyles, space, TRACK_ROW_HEIGHT, useColors } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

/** Generic fixed-height row (playlists, artists, albums in lists, settings links). */
function ListRowImpl({
  leading,
  title,
  subtitle,
  subtitleColor,
  onPress,
  onLongPress,
  trailing,
  chevron,
  onContextMenu,
  nestedActions,
}: {
  /** Wide layout: right-click menu at the cursor. */
  onContextMenu?: (anchor: SheetAnchor) => void;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  /** A subtitle that needs attention (a warning); secondary text otherwise. */
  subtitleColor?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
  /** `trailing` holds its own buttons. Web screen readers can't reach a button nested in a button, so the row becomes a group. */
  nestedActions?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const wide = useIsWide();
  return (
    <Pressable
      accessibilityRole={nestedActions && Platform.OS === 'web' ? 'group' : 'button'}
      accessibilityLabel={nestedActions && Platform.OS === 'web' ? (subtitle ? `${title}, ${subtitle}` : title) : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      android_ripple={{ color: colors.ripple }}
      {...contextMenu(onContextMenu)}
      style={({ pressed, hovered }) => [styles.row, wide && styles.rowWide, (pressed || hovered) && styles.pressed]}>
      {leading}
      <View style={styles.meta}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1} color={subtitleColor}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

export const ListRow = memo(ListRowImpl);

const useStyles = makeStyles((colors) => ({
  row: {
    minHeight: TRACK_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.md,
  },
  rowWide: { marginHorizontal: space.xl, paddingHorizontal: space.sm, borderRadius: 8, minHeight: 64 },
  pressed: { backgroundColor: colors.pressed },
  meta: { flex: 1, minWidth: 0, gap: 2 },
}));
