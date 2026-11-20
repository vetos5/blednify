import { Pressable, StyleSheet, View } from 'react-native';

import { nextUp, player, usePlayer } from '@/core';
import { Artwork } from '@/ui/components/Artwork';
import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/Text';
import { haptics } from '@/ui/haptics';
import { nav } from '@/ui/nav';
import { makeStyles, radius, space, useColors } from '@/ui/theme';
import { useGlassSurface } from '../../chrome';
import { spokenLabel } from '../../a11y';

export function UpNextCard() {
  const styles = useStyles();
  const glass = useGlassSurface();
  const colors = useColors();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const repeatAll = usePlayer((s) => s.repeat === 'all');

  // The next four in play order; with repeat all the head of the queue follows the last song.
  const upNext = nextUp(index, queue.length, repeatAll, 4).map((i) => ({ track: queue[i], queueIndex: i }));

  const openQueue = () => {
    haptics.tap();
    nav.queue();
  };

  const handleJump = (targetIndex: number) => {
    haptics.tap();
    player.jumpTo(targetIndex);
  };

  return (
    <View style={[styles.card, glass]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text variant="subheading" style={styles.title}>
            Up next
          </Text>
          {upNext.length > 0 ? (
            <Text variant="caption" color={colors.textSecondary}>
              · {repeatAll ? `${queue.length - 1} on repeat` : `${queue.length - 1 - index} in queue`}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={openQueue}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open queue"
          style={({ pressed }) => [styles.linkPressable, pressed && styles.pressed]}>
          <Text variant="caption" color={colors.accentText} style={styles.openQueueText}>
            Open queue
          </Text>
          <Icon name="chevron-forward" size={14} color={colors.accentText} />
        </Pressable>
      </View>

      {upNext.length > 0 ? (
        <View style={styles.list}>
          {upNext.map(({ track, queueIndex }) => {
            return (
              <Pressable
                key={`${queueIndex}:${track.key}`}
                onPress={() => handleJump(queueIndex)}
                accessibilityRole="button"
                accessibilityLabel={spokenLabel(`Play ${track.title} by ${track.artist}`)}
                android_ripple={{ color: colors.ripple }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <Artwork
                  uri={track.artworkUri}
                  label={track.album || track.title}
                  size={44}
                  radius={radius.sm}
                  recyclingKey={track.key}
                />
                <View style={styles.meta}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text variant="caption" numberOfLines={1}>
                    {track.artist}
                  </Text>
                </View>
                <Icon name="play-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text variant="caption" color={colors.textSecondary}>
            Nothing up next in queue
          </Text>
        </View>
      )}

      <Pressable
        onPress={openQueue}
        accessibilityRole="button"
        accessibilityLabel="Open full queue"
        style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]}>
        <Text variant="bodyStrong" color={colors.text}>
          Open queue
        </Text>
        <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  linkPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  openQueueText: {
    fontWeight: '700',
  },
  list: {
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  emptyContainer: {
    paddingVertical: space.md,
    alignItems: 'center',
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
}));
