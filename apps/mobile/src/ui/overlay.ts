import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { makeMutable, withTiming } from 'react-native-reanimated';
import { create } from 'zustand';

import { dropsOnRouteChange, ROUTE_CHANGE_GRACE_MS } from './toast-scope';

export type ToastKind = 'info' | 'success' | 'error' | 'progress';
/** Optional button on a toast (e.g. "Undo"). Pressing it dismisses the toast first, then runs `onPress`. */
export type ToastAction = { label: string; onPress: () => void };
/** `at` is when it was shown (ms since epoch), so a route change can tell a stale note from a fresh one. */
export type ToastData = { id: number; message: string; detail?: string; kind: ToastKind; action?: ToastAction; at: number };
/** A toast's text: one line, or a title with a quieter second line. */
export type ToastText = string | { title: string; detail?: string };

/** Screen point a sheet opens from in the wide layout (a right-click), shown there as a menu. */
export type SheetAnchor = { x: number; y: number };

type OverlayState = {
  sheet: { id: number; content: ReactNode; anchor?: SheetAnchor } | null;
  toast: ToastData | null;
};

export const useOverlay = create<OverlayState>(() => ({ sheet: null, toast: null }));

let seq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Present arbitrary content in the global bottom sheet. Replaces any open sheet. The wide layout shows it as
 * a dialog, or as a context menu at `anchor`.
 */
export function showSheet(content: ReactNode, opts: { anchor?: SheetAnchor } = {}) {
  useOverlay.setState({ sheet: { id: ++seq, content, anchor: opts.anchor } });
}

export function closeSheet() {
  useOverlay.setState({ sheet: null });
}

/**
 * Show a toast. `progress` toasts stay until replaced or dismissed; others auto-hide.
 * Returns the toast id so callers can dismiss exactly their own toast.
 */
export function showToast(text: ToastText, kind: ToastKind = 'info', action?: ToastAction): number {
  clearTimeout(toastTimer);
  const id = ++seq;
  const { title: message, detail } = typeof text === 'string' ? { title: text, detail: undefined } : text;
  const at = Date.now();
  useOverlay.setState({ toast: { id, message, detail, kind, action, at } });
  // What a dismiss gesture needs to hide this one on the UI thread (`veilScreenToast`): from when it may be dropped.
  toastDropAt.set(dropsOnRouteChange({ kind, action, at }, at + ROUTE_CHANGE_GRACE_MS) ? at + ROUTE_CHANGE_GRACE_MS : Infinity);
  toastVeil.set(0);
  // A live region on a freshly mounted view isn't announced reliably on Android; say it explicitly.
  const spoken = detail ? `${message}. ${detail}` : message;
  if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(action ? `${spoken}. ${action.label} available` : spoken);
  if (kind !== 'progress') {
    toastTimer = setTimeout(() => dismissToast(id), kind === 'error' ? 4000 : action ? 6000 : 2400);
  }
  return id;
}

export function dismissToast(id?: number) {
  const { toast } = useOverlay.getState();
  if (toast && (id === undefined || toast.id === id)) useOverlay.setState({ toast: null });
}

/**
 * Hides the toast host (1) while a dropped toast leaves. Driven from the UI thread by a dismiss gesture
 * (`veilScreenToast`): the JS drop came 0.35-0.7 s after the player sheet was gone, behind the busy JS thread of the
 * dismiss, so "Added to queue" sat over the Home header. The next toast clears it.
 */
export const toastVeil = makeMutable(0);
/** When (ms since epoch) the current toast may be dropped by leaving its screen; Infinity when it stays. */
const toastDropAt = makeMutable(Number.POSITIVE_INFINITY);

/** Worklet: a dismiss gesture committed; hide the screen's own note now (same rule as `dropScreenToast`). */
export function veilScreenToast() {
  'worklet';
  if (Date.now() >= toastDropAt.get()) toastVeil.set(withTiming(1, { duration: 90 }));
}

/**
 * The user is leaving the screen: drop its own note (see `dropsOnRouteChange`). Called on a route change, and when a
 * dismiss gesture commits, so the note doesn't outlive a screen that is already sliding away.
 */
export function dropScreenToast() {
  const { toast } = useOverlay.getState();
  if (toast && dropsOnRouteChange(toast, Date.now())) dismissToast(toast.id);
}
