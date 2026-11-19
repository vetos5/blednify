import { Dimensions, Platform, useWindowDimensions } from 'react-native';

import { trackRowHeight } from './theme';

/**
 * Wide layout: the web app in a desktop browser or on a tablet. It swaps the phone's bottom tabs and
 * full-screen player for a sidebar, a persistent player bar and a side panel (see `ui/desktop`).
 * Native apps keep the phone layout at any size.
 */
export const WIDE_MIN_WIDTH = 768;
/** Below this the sidebar collapses to an icon rail. */
export const SIDEBAR_FULL_MIN_WIDTH = 1100;
/** Below this the queue / lyrics panel overlays the page instead of sitting beside it. */
export const PANEL_INLINE_MIN_WIDTH = 1180;

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_RAIL_WIDTH = 72;
export const PANEL_WIDTH = 352;
export const PLAYER_BAR_HEIGHT = 84;

const isWeb = Platform.OS === 'web';

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return isWeb && width >= WIDE_MIN_WIDTH;
}

/** Same as `useIsWide`, for event handlers and other code outside render. */
export function isWideNow(): boolean {
  return isWeb && Dimensions.get('window').width >= WIDE_MIN_WIDTH;
}

/** True while the last pointer the user touched the page with is a mouse or pen (not a finger). */
let finePointer = isWeb && typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;
if (isWeb && typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      finePointer = e.pointerType !== 'touch';
    },
    { capture: true, passive: true },
  );
}
export const usesFinePointer = () => finePointer;

/** Page side padding: roomier in the wide layout. */
export function useGutter(): number {
  return useIsWide() ? 32 : 16;
}

const READABLE = { width: '100%', maxWidth: 760, alignSelf: 'center' } as const;

/** Form-like pages (settings, appearance) keep a readable column in the wide layout instead of stretching. */
export function useReadableColumn() {
  return useIsWide() ? READABLE : null;
}

/** `trackRowHeight` for the current system font scale (see theme.ts). */
export function useTrackRowHeight(): number {
  return trackRowHeight(useWindowDimensions().fontScale);
}
