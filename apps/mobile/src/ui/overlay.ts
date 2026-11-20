import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'progress';
/** Optional button on a toast (e.g. "Undo"). Pressing it dismisses the toast first, then runs `onPress`. */
export type ToastAction = { label: string; onPress: () => void };
export type ToastData = { id: number; message: string; detail?: string; kind: ToastKind; action?: ToastAction };
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
  useOverlay.setState({ toast: { id, message, detail, kind, action } });
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
