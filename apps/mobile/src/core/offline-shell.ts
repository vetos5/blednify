import { Platform } from 'react-native';

/**
 * Web: registers the offline shell (public/sw.js), so the iPhone home-screen app opens without a connection and shows
 * its library instead of Safari's error page. Production builds on a secure origin only (service workers need one,
 * and in development the worker would only get in the way of Metro).
 */
export function registerOfflineShell(): void {
  if (Platform.OS !== 'web' || __DEV__) return;
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[web] offline shell', e));
}
