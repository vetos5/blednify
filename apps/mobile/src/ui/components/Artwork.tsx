import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { gradientFor, makeStyles, radius as radii } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { sizedArtworkUrl, useImageSource } from '@/core';

/** A blurred cover needs little source detail, even behind a full-screen surface. */
const BACKDROP_PX = 64;

export type ArtworkProps = {
  uri: string | null | undefined;
  /** Text used for the fallback tile initials and gradient seed (album / artist / track title). */
  label: string;
  size?: number;
  radius?: number;
  round?: boolean;
  /** Use an icon instead of initials in the fallback tile. */
  fallbackIcon?: IconName;
  recyclingKey?: string;
  priority?: 'low' | 'normal' | 'high';
  style?: StyleProp<ViewStyle>;
};

function initials(label: string) {
  const words = label
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '♪';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

/** Cover art via expo-image (memory+disk cache) with a branded gradient fallback. */
export function Artwork({ uri, label, size, radius = radii.sm, round, fallbackIcon, recyclingKey, priority, style }: ArtworkProps) {
  const styles = useStyles();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const measure = Platform.OS === 'web' && size === undefined;
  // Grid cells can be wider on desktop. Wait for their actual width instead of decoding an original
  // or requesting a phone-sized thumbnail first. Native keeps its original source and layout path.
  const source = useImageSource(measure && !measuredWidth ? null : uri, size ?? measuredWidth);
  const showImage = !!uri && uri !== failedUri;
  const borderRadius = round ? 9999 : radius;
  const box = size !== undefined ? { width: size, height: size } : styles.fill;

  return (
    <View
      style={[styles.base, box, { borderRadius }, style]}
      onLayout={measure ? (e) => setMeasuredWidth(Math.ceil(e.nativeEvent.layout.width)) : undefined}>
      {showImage ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey ?? uri}
          transition={120}
          priority={priority}
          onError={() => setFailedUri(uri)}
          // Decorative: the row or card around it carries the name. (expo-image web ignores `alt` on the loaded image.)
          accessibilityLabel=""
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Fallback label={label} icon={fallbackIcon} size={size} />
      )}
    </View>
  );
}

/**
 * Full-bleed cover behind a screen. Keep the original blur/tint, using a small source on web to reduce
 * decoded image memory. Stretching an unblurred 16px cover visibly changes high-contrast artwork.
 */
export function ArtworkBackdrop({ uri, blurRadius, transition }: { uri: string | null | undefined; blurRadius: number; transition: number }) {
  const web = Platform.OS === 'web';
  const backdropUri = web && uri ? sizedArtworkUrl(uri, BACKDROP_PX) : uri;
  const source = useImageSource(backdropUri);
  if (!source) return null;
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      blurRadius={blurRadius}
      cachePolicy="memory-disk"
      transition={transition}
      accessibilityLabel=""
    />
  );
}

function Fallback({ label, icon, size }: { label: string; icon?: IconName; size?: number }) {
  const styles = useStyles();
  const [from, to] = gradientFor(label);
  const glyph = size !== undefined ? Math.max(12, Math.round(size * 0.34)) : 40;
  return (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fallback}>
      {icon ? (
        <Icon name={icon} size={glyph} color="rgba(255,255,255,0.92)" />
      ) : (
        <Text style={[styles.initials, { fontSize: glyph, lineHeight: glyph * 1.15 }]}>{initials(label)}</Text>
      )}
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  base: { overflow: 'hidden', backgroundColor: colors.surface2 },
  fill: { width: '100%', aspectRatio: 1 },
  fallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  initials: { color: 'rgba(255,255,255,0.92)', fontWeight: '800', letterSpacing: -0.5 },
}));
