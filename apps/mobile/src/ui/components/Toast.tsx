import { useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, FadeOutDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayer } from '@/core';

import { PLAYER_BAR_HEIGHT, useIsWide } from '../layout';
import { dismissToast, showToast, useOverlay, type ToastKind } from '../overlay';
import { makeStyles, radius, space, useColors } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { TopLayer } from './TopLayer';

const ICONS: Record<Exclude<ToastKind, 'progress'>, { name: IconName; color: 'textSecondary' | 'success' | 'danger' }> = {
  info: { name: 'information-circle', color: 'textSecondary' },
  success: { name: 'checkmark-circle', color: 'success' },
  error: { name: 'alert-circle', color: 'danger' },
};

/** Global toast host (mounted once in the root layout). Use `showToast()` to trigger. */
export function ToastHost() {
  const styles = useStyles();
  const colors = useColors();
  const toast = useOverlay((s) => s.toast);
  const insets = useSafeAreaInsets();
  // Wide layout: toasts rise from above the player bar, out of the way of page headers.
  const wide = useIsWide();
  usePlaybackErrorToasts();
  return (
    <TopLayer>
      <View pointerEvents="box-none" style={[styles.host, wide ? { bottom: PLAYER_BAR_HEIGHT + space.lg } : { top: insets.top + space.sm }]}>
        {toast ? (
          <Animated.View
            key={toast.id}
            entering={(wide ? FadeInDown : FadeInUp).duration(220)}
            exiting={(wide ? FadeOutDown : FadeOutUp).duration(180)}
            style={styles.toast}
            // Native screen readers get the message from showToast(); the live region covers the web app.
            accessibilityLiveRegion={Platform.OS === 'web' ? 'polite' : 'none'}
            accessibilityRole="alert"
            onTouchEnd={() => toast.kind !== 'progress' && !toast.action && dismissToast(toast.id)}>
            {toast.kind === 'progress' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Icon name={ICONS[toast.kind].name} size={20} color={colors[ICONS[toast.kind].color]} />
            )}
            <Text variant="bodyStrong" style={styles.message} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
                hitSlop={8}
                style={styles.action}
                onPress={() => {
                  const { onPress } = toast.action!;
                  dismissToast(toast.id);
                  onPress();
                }}>
                <Text variant="bodyStrong" color={colors.accent}>
                  {toast.action.label}
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </TopLayer>
  );
}

/** Surfaces every playback error app-wide; `errorId` changes even when the message repeats. */
function usePlaybackErrorToasts() {
  const error = usePlayer((s) => s.error);
  const errorId = usePlayer((s) => s.errorId);
  useEffect(() => {
    if (error) showToast(error, 'error');
  }, [error, errorId]);
}

const useStyles = makeStyles((colors) => ({
  host: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    maxWidth: 480,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    shadowColor: colors.black,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  message: { flexShrink: 1 },
  action: { paddingHorizontal: space.xs, paddingVertical: space.xs, minHeight: 32, justifyContent: 'center' },
}));
