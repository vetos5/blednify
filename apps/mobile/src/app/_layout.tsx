import { View , Platform } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Fragment, useEffect, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CoreProvider } from '@/core';
import { ActionSheetHost } from '@/ui/components/ActionSheet';
import { ToastHost } from '@/ui/components/Toast';
import { DesktopShell } from '@/ui/desktop/DesktopShell';
import { useWebChrome } from '@/ui/desktop/web-chrome';
import { useIsWide } from '@/ui/layout';
import { trackRootFocus, useRootTop } from '@/ui/nav';
import { makeStyles, navigationThemeFor, useColors } from '@/ui/theme';

// Expo Router supplies zero insets on web. Measure CSS env(safe-area-inset-*) for the existing screen padding.
const SafeArea = Platform.OS === 'web' ? SafeAreaProvider : Fragment;

export default function RootLayout() {
  const styles = useStyles();
  const colors = useColors();
  const wide = useIsWide();
  useWebChrome();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);
  const stack = (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: styles.content, animation: wide ? 'fade' : 'ios_from_right' }}
      screenListeners={({ route }) => ({ focus: () => trackRootFocus(route.name) })}
      screenLayout={({ route, children }) => <CoveredScreen name={route.name}>{children}</CoveredScreen>}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="player"
        options={{
          presentation: 'transparentModal',
          animation: wide ? 'fade' : 'slide_from_bottom',
          gestureEnabled: false,
          contentStyle: styles.transparent,
        }}
      />
      <Stack.Screen name="queue" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="lyrics" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
  return (
    <SafeArea>
      <GestureHandlerRootView style={styles.root}>
        <CoreProvider>
          <ThemeProvider value={navigationThemeFor(colors)}>
            <StatusBar style={colors.isLight ? 'dark' : 'light'} />
            {wide ? (
              <DesktopShell>{stack}</DesktopShell>
            ) : (
              // Web landmark: screen readers can jump straight to the page content.
              <View role="main" style={styles.root}>
                {stack}
              </View>
            )}
            <ActionSheetHost />
            <ToastHost />
          </ThemeProvider>
        </CoreProvider>
      </GestureHandlerRootView>
    </SafeArea>
  );
}

/** Root-stack screens drawn see-through: what's under them stays mounted and on screen. */
const TRANSPARENT_OVER = new Set(['player']);

/**
 * The player is a transparent modal, so the screen under it stays mounted and in the accessibility tree: TalkBack
 * could swipe from the player's controls into the Home grid behind it and play songs nobody can see. While a
 * see-through screen is on top, every other root screen is hidden from screen readers (iOS/web use aria-hidden;
 * screens under an opaque modal are detached natively already).
 */
function CoveredScreen({ name, children }: { name: string; children: ReactNode }) {
  const styles = useStyles();
  const top = useRootTop();
  const covered = top !== name && TRANSPARENT_OVER.has(top);
  return (
    <View style={styles.screen} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'} aria-hidden={covered}>
      {children}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1 },
  root: { flex: 1, backgroundColor: colors.bg },
  content: { backgroundColor: colors.bg },
  transparent: { backgroundColor: 'transparent' },
}));
