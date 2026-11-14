import { type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '../haptics';
import { useGlassSurface } from '../chrome';
import { makeStyles, useColors, type Palette } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

type Variant = 'plain' | 'filled' | 'accent' | 'scrim';

export type IconButtonProps = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  /** Diameter of the touch target / background circle. */
  diameter?: number;
  color?: string;
  variant?: Variant;
  haptic?: boolean;
  disabled?: boolean;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
};

function bgFor(variant: Variant, colors: Palette): string | undefined {
  if (variant === 'filled') return colors.surface2;
  if (variant === 'accent') return colors.accent;
  if (variant === 'scrim') return 'rgba(10,10,12,0.55)';
  return undefined;
}

export function IconButton({
  icon,
  label,
  onPress,
  onLongPress,
  size = 22,
  diameter = 44,
  color,
  variant = 'plain',
  haptic = false,
  disabled,
  strokeWidth,
  style,
}: IconButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  const glass = useGlassSurface();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={diameter < 44 ? (44 - diameter) / 2 : 0}
      disabled={disabled}
      activeScale={0.88}
      onLongPress={onLongPress}
      onPress={() => {
        if (haptic) haptics.tap();
        onPress?.();
      }}
      style={[
        styles.base,
        { width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: bgFor(variant, colors) },
        variant === 'filled' && glass,
        disabled && styles.disabled,
        style,
      ]}>
      <Icon
        name={icon}
        size={size}
        color={color ?? (variant === 'accent' ? colors.onAccent : variant === 'scrim' ? '#FFFFFF' : colors.text)}
        strokeWidth={strokeWidth}
      />
    </PressableScale>
  );
}

const useStyles = makeStyles(() => ({
  base: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
}));
