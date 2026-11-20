import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * Light status bar for the always-dark player and lyrics, only while that screen is on top. expo-status-bar keeps a
 * stack of mounted bars and the newest wins, so an unscoped bar stayed in force under the Queue pushed over the
 * player: white clock on the Daylight queue. Unmounting on blur hands the bar back to the root's theme-aware one.
 */
export function ImmersiveStatusBar() {
  return useIsFocused() ? <StatusBar style="light" /> : null;
}
