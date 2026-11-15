import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nav } from '../nav';
import { makeStyles, radius, space, useColors } from '../theme';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { PrimaryButton } from './PrimaryButton';
import { Text } from './Text';

const ANDROID_PACKAGE = 'pro.vetos.blednify';

/** A shared link opened in a phone browser on Android, outside the installed web app. */
const offerApp =
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  /Android/i.test(navigator.userAgent) &&
  typeof window !== 'undefined' &&
  !window.matchMedia?.('(display-mode: standalone)').matches;

/**
 * "Open in app" pill for shared pages. An `intent:` link starts the Android app at the same page and does
 * nothing when it is not installed, so the browser page stays usable either way.
 */
export function OpenInApp({ path }: { path: string }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!offerApp) return null;
  const href = `intent:/${path}#Intent;scheme=blednify;package=${ANDROID_PACKAGE};end`;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + space.sm }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open in app, Blednify"
        onPress={() => {
          window.location.href = href;
        }}
        style={styles.pill}>
        <Icon name="open-outline" size={16} color={colors.onAccent} />
        <Text variant="bodyStrong" color={colors.onAccent}>
          Open in app
        </Text>
      </Pressable>
    </View>
  );
}

/** A shared link that could not be loaded: gone from the server, or this device is not connected to it. */
export function SharedNotFound({ kind, hasServer }: { kind: string; hasServer: boolean }) {
  return (
    <EmptyState
      icon="link-outline"
      title={hasServer ? `Couldn’t open this ${kind}` : 'Not connected to a server'}
      message={
        hasServer
          ? 'It may have been removed, or this device isn’t signed in to the server it was shared from.'
          : 'Shared links open music from a Blednify server. Connect to the same server in Settings first.'
      }>
      <PrimaryButton label="Open settings" variant="surface" onPress={nav.settings} />
    </EmptyState>
  );
}

const useStyles = makeStyles((colors) => ({
  host: { position: 'absolute', right: space.lg, zIndex: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
}));
