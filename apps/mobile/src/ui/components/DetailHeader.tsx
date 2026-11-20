import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '../desktop/web';
import { useGutter, useIsWide } from '../layout';
import { makeStyles, radius, space, useColors, withAlpha } from '../theme';
import { ArtworkBackdrop } from './Artwork';
import { Backdrop } from './Backdrop';
import { PrimaryButton } from './PrimaryButton';
import { Text } from './Text';

export type DetailHeaderProps = {
  /** Rendered artwork (Artwork / PlaylistArtwork) sized by the header. */
  renderArtwork: (size: number) => ReactNode;
  /** Image used for the blurred backdrop. */
  backdropUri: string | null | undefined;
  eyebrow: string;
  title: string;
  subtitle?: string;
  onSubtitlePress?: () => void;
  meta?: string;
  onPlay?: () => void;
  /** `null` hides Shuffle (a single song); undefined shows it disabled (an empty list). */
  onShuffle?: (() => void) | null;
  /** Extra action buttons rendered next to Play / Shuffle. */
  actions?: ReactNode;
  children?: ReactNode;
};

/** Full-bleed header with blurred artwork backdrop + gradient, artwork, titles and Play / Shuffle. */
export function DetailHeader({
  renderArtwork,
  backdropUri,
  eyebrow,
  title,
  subtitle,
  onSubtitlePress,
  meta,
  onPlay,
  onShuffle,
  actions,
  children,
}: DetailHeaderProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = useIsWide();
  const gutter = useGutter();
  const art = wide ? 232 : Math.min(240, Math.round(width * 0.6));
  const disabled = !onPlay;

  const backdrop = <DetailGlow uri={backdropUri} />;

  if (wide) {
    // Wide layout: cover beside the titles, buttons sized to their labels.
    return (
      <View style={[styles.root, { paddingTop: space.xxxl + space.xl, paddingHorizontal: gutter, gap: space.xl }, !!children && styles.rootWithTable]}>
        {backdrop}
        <View style={styles.wideRow}>
          <View style={[styles.art, styles.wideArt, { width: art, height: art }]}>{renderArtwork(art)}</View>
          <View style={styles.wideText}>
            <Text variant="micro" color={colors.accentText}>
              {eyebrow.toUpperCase()}
            </Text>
            <Text variant="display" numberOfLines={2} style={styles.wideTitle}>
              {title}
            </Text>
            <View style={styles.wideMeta}>
              {subtitle ? (
                <Pressable disabled={!onSubtitlePress} onPress={onSubtitlePress}>
                  {({ hovered }) => (
                    <Text variant="bodyStrong" color={colors.text} numberOfLines={1} style={hovered && onSubtitlePress ? styles.underline : undefined}>
                      {subtitle}
                    </Text>
                  )}
                </Pressable>
              ) : null}
              {subtitle && meta ? <Text variant="caption">·</Text> : null}
              {meta ? (
                <Text variant="caption" numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.buttons}>
          <PrimaryButton label="Play" icon="play" onPress={() => onPlay?.()} disabled={disabled} style={styles.wideButton} />
          {onShuffle === null ? null : <PrimaryButton label="Shuffle" icon="shuffle" variant="surface" onPress={() => onShuffle?.()} disabled={!onShuffle} style={styles.wideButton} />}
          {actions}
        </View>
        {/* Full-bleed children (track table header) line up with the list rows, not the padded titles. */}
        {children ? <View style={{ marginHorizontal: -gutter }}>{children}</View> : null}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxxl }]}>
      {backdrop}
      <View style={[styles.art, { width: art, height: art }]}>{renderArtwork(art)}</View>
      <View style={styles.text}>
        <Text variant="micro" color={colors.accentText}>
          {eyebrow.toUpperCase()}
        </Text>
        <Text variant="title" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Pressable disabled={!onSubtitlePress} onPress={onSubtitlePress} hitSlop={6}>
            <Text variant="bodyStrong" color={colors.text} numberOfLines={1}>
              {subtitle}
            </Text>
          </Pressable>
        ) : null}
        {meta ? (
          <Text variant="caption" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={styles.buttons}>
        <PrimaryButton label="Play" icon="play" onPress={() => onPlay?.()} disabled={disabled} style={styles.flex} />
        {onShuffle === null ? null : <PrimaryButton label="Shuffle" icon="shuffle" variant="surface" onPress={() => onShuffle?.()} disabled={!onShuffle} style={styles.flex} />}
        {actions}
      </View>
      {children}
    </View>
  );
}

/** Height of the cover glow at the top of a detail page. */
export const DETAIL_GLOW_HEIGHT = 460;

/**
 * The cover-tinted glow behind the top of a detail page: the blurred cover (or an accent wash without one) fading
 * into the theme background. DetailHeader draws it inside the list, so it scrolls with the content.
 */
function DetailGlow({ uri }: { uri: string | null | undefined }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.backdrop, colors.backdrop !== 'none' && fadeOut]} pointerEvents="none">
      <ArtworkBackdrop uri={uri} blurRadius={60} transition={200} />
      <LinearGradient
        colors={
          uri
            ? [withAlpha(colors.bg, 0.35), withAlpha(colors.bg, 0.75), colors.bg]
            : [colors.isLight ? colors.accentSoft : colors.accentDeep, withAlpha(colors.bg, 0.6), colors.bg]
        }
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/**
 * The page background of a detail page as it stands at a scroll offset: the theme backdrop plus the header's glow
 * moved up by `offsetY` (the list's scroll offset, clamped to the glow height). StatusBarScrim draws it as its band,
 * so the band under the clock continues the glow pixel for pixel instead of laying a flat slab over it.
 */
export function DetailGlowSurface({ uri, offsetY }: { uri: string | null | undefined; offsetY: SharedValue<number> }) {
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: -offsetY.get() }] }));
  return (
    <>
      <Backdrop still />
      <Animated.View style={[StyleSheet.absoluteFill, moved]} pointerEvents="none">
        <DetailGlow uri={uri} />
      </Animated.View>
    </>
  );
}

/**
 * Themes with a backdrop (glow, stars) draw it behind the whole screen. The cover backdrop ends in solid `bg`,
 * so where it stops the theme backdrop reappears with a hard edge. On web, fade the layer out instead.
 */
const fadeOut =
  Platform.OS === 'web'
    ? ({
        maskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
      } as unknown as ViewStyle)
    : null;

const useStyles = makeStyles((colors) => ({
  root: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, height: DETAIL_GLOW_HEIGHT, overflow: 'hidden' },
  art: {
    alignSelf: 'center',
    borderRadius: radius.lg,
    shadowColor: colors.black,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
    backgroundColor: colors.surface2,
  },
  text: { gap: space.xs },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  rootWithTable: { paddingBottom: 0 },
  wideRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xl },
  wideArt: { alignSelf: 'auto' },
  wideText: { flex: 1, minWidth: 0, gap: space.sm, paddingBottom: space.xs },
  wideTitle: { fontSize: 52, lineHeight: 58, letterSpacing: -1.8 },
  wideMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  wideButton: { minWidth: 132, paddingHorizontal: space.xl },
  underline: { textDecorationLine: 'underline' },
}));
