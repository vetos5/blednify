import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, FadeOutDown, FadeOutUp, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayer } from '@/core';

import { HEADER_ROW_HEIGHT, PLAYER_BAR_HEIGHT, useIsWide } from '../layout';
import { dismissToast, dropScreenToast, showToast, toastVeil, useOverlay, type ToastKind } from '../overlay';
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
  // Wide layout: toasts rise from above the player bar, out of the way of page headers. Phone layout: they drop in
  // just below the header row, so Back stays visible and tappable while one is up (it used to sit over the chevron).
  const wide = useIsWide();
  usePlaybackErrorToasts();
  useDropScreenToastsOnRouteChange();
  // A dismiss gesture hides a dropped note from the UI thread (`veilScreenToast`); the wrapper, not the keyed toast,
  // so its exit animation runs hidden instead of starting from opaque again.
  const veil = useAnimatedStyle(() => ({ opacity: 1 - toastVeil.get() }));
  return (
    <TopLayer>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.host, wide ? { bottom: PLAYER_BAR_HEIGHT + space.lg } : { top: insets.top + HEADER_ROW_HEIGHT + space.xs }, veil]}>
        {toast ? (
          <Animated.View
            key={toast.id}
            // Opaque from the first frame, sliding the last 10 px into place: a fade showed the page header through
            // the card while it came in (still faintly at 0.85).
            entering={(wide ? FadeInDown : FadeInUp)
              .duration(160)
              .withInitialValues({ opacity: 1, transform: [{ translateY: wide ? 10 : -10 }] })}
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
            <View style={styles.message}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {toast.message}
              </Text>
              {toast.detail ? (
                <Text variant="caption" color={colors.textSecondary} numberOfLines={2}>
                  {toast.detail}
                </Text>
              ) : null}
            </View>
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
                <Text variant="bodyStrong" color={colors.accentText}>
                  {toast.action.label}
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </Animated.View>
    </TopLayer>
  );
}

/**
 * Clears a screen's own note when the user leaves that screen ("Added to queue" raised on the player used to stay up
 * over the Home header after the player closed). See dropsOnRouteChange for which toasts stay; the player's pull-down
 * drops them as soon as it commits (`dropScreenToast`), since the route changes only once the sheet is gone.
 */
function useDropScreenToastsOnRouteChange() {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    dropScreenToast();
  }, [pathname]);
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
  message: { flexShrink: 1, gap: 2 },
  action: { paddingHorizontal: space.xs, paddingVertical: space.xs, minHeight: 32, justifyContent: 'center' },
}));
