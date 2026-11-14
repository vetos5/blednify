import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'progress';
export type ToastData = { id: number; message: string; kind: ToastKind };

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
export function showToast(message: string, kind: ToastKind = 'info'): number {
  clearTimeout(toastTimer);
  const id = ++seq;
  useOverlay.setState({ toast: { id, message, kind } });
  // A live region on a freshly mounted view isn't announced reliably on Android; say it explicitly.
  if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(message);
  if (kind !== 'progress') {
    toastTimer = setTimeout(() => dismissToast(id), kind === 'error' ? 4000 : 2400);
  }
  return id;
}

export function dismissToast(id?: number) {
  const { toast } = useOverlay.getState();
  if (toast && (id === undefined || toast.id === id)) useOverlay.setState({ toast: null });
}
