import { View , Platform } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Fragment, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CoreProvider } from '@/core';
import { ActionSheetHost } from '@/ui/components/ActionSheet';
import { ToastHost } from '@/ui/components/Toast';
import { DesktopShell } from '@/ui/desktop/DesktopShell';
import { useWebChrome } from '@/ui/desktop/web-chrome';
import { useIsWide } from '@/ui/layout';
import { trackRootFocus } from '@/ui/nav';
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
      screenListeners={({ route }) => ({ focus: () => trackRootFocus(route.name) })}>
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

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { backgroundColor: colors.bg },
  transparent: { backgroundColor: 'transparent' },
}));
