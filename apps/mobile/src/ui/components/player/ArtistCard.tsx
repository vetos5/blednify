import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useArtist, useImageSource, type AppTrack } from '@/core';
import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/Text';
import { plural } from '@/ui/format';
import { haptics } from '@/ui/haptics';
import { nav } from '@/ui/nav';
import { makeStyles, radius, space, useColors } from '@/ui/theme';
import { useGlassSurface } from '../../chrome';
import { spokenLabel } from '../../a11y';

export function ArtistCard({ track }: { track: AppTrack }) {
  const styles = useStyles();
  const glass = useGlassSurface();
  const colors = useColors();
  const { artist } = useArtist(track.artistId, track.origin);
  const imageUri = artist?.artworkUri ?? track.artworkUri;
  // The card spans the screen.
  const source = useImageSource(imageUri, useWindowDimensions().width);

  const handlePress = () => {
    haptics.tap();
    router.back();
    nav.artist(track.artistId, track.origin);
  };

  const subtitle = artist?.albumCount
    ? `${plural(artist.albumCount, 'album')}${artist.trackCount ? ` · ${plural(artist.trackCount, 'song')}` : ''}`
    : 'Artist';

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel(`About ${track.artist}, tap to view artist`)}
      style={({ pressed }) => [styles.card, glass, pressed && styles.pressed]}>
      {imageUri ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={250}
          accessibilityLabel=""
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholderBg]} />
      )}

      <LinearGradient
        colors={['rgba(10,10,12,0.4)', 'rgba(10,10,12,0.6)', 'rgba(10,10,12,0.92)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.content}>
        <View style={styles.topBadge}>
          <Text variant="micro" color="rgba(255,255,255,0.85)">
            ABOUT THE ARTIST
          </Text>
        </View>

        <View style={styles.bottomInfo}>
          <View style={styles.textWrap}>
            <Text style={styles.artistName} numberOfLines={1}>
              {track.artist}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <View style={styles.chevronWrap}>
            <Icon name="chevron-forward" size={20} color={colors.white} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    height: 190,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.9,
  },
  placeholderBg: {
    backgroundColor: colors.surface2,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    padding: space.lg,
  },
  topBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.sm,
  },
  bottomInfo: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  artistName: {
    color: colors.white,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  chevronWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
