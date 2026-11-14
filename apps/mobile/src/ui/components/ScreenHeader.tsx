import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIsWide } from '../layout';
import { goBack } from '../nav';
import { makeStyles, space } from '../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

/** Simple top bar for secondary screens: back, title, optional trailing actions. */
export function ScreenHeader({
  title,
  right,
  backIcon = 'chevron-back',
}: {
  title: string;
  right?: ReactNode;
  backIcon?: 'chevron-back' | 'chevron-down';
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.xs }]}>
      <IconButton icon={backIcon} label="Back" size={26} onPress={goBack} />
      <Text variant="subheading" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

/** Floating back button for full-bleed screens (album / artist / playlist). */
export function FloatingBack() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  return (
    <View style={[styles.floating, wide && styles.floatingWide, { top: insets.top + (wide ? space.lg : space.xs) }]} pointerEvents="box-none">
      <IconButton icon="chevron-back" label="Back" variant="scrim" size={24} diameter={40} onPress={goBack} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingBottom: space.sm, gap: space.xs },
  title: { flex: 1, textAlign: 'center' },
  right: { minWidth: 44, flexDirection: 'row', justifyContent: 'flex-end' },
  floating: { position: 'absolute', left: space.md, zIndex: 10 },
  floatingWide: { left: space.lg },
}));
