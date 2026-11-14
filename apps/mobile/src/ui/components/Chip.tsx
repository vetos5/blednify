import { StyleSheet } from 'react-native';

import { haptics } from '../haptics';
import { useGlassSurface } from '../chrome';
import { makeStyles, radius, space, useColors } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress: () => void; icon?: IconName }) {
  const styles = useStyles();
  const colors = useColors();
  const glass = useGlassSurface();
  const fg = selected ? colors.onAccent : colors.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      hitSlop={5}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={[styles.chip, glass, selected && styles.selected]}>
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text variant="caption" color={fg} style={styles.label}>
        {label}
      </Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    height: 34,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { fontWeight: '600' },
}));
