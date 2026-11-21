import type { ToastData } from './overlay';

/**
 * A toast younger than this when the route changes came with the navigation (an action that shows its result and
 * then leaves the screen, e.g. "Deleted" then Back), so it stays to be read on the next screen.
 */
export const ROUTE_CHANGE_GRACE_MS = 600;

/**
 * Whether a toast should go when the user moves to another screen. A plain info or success note is about the screen
 * it was raised on ("Added to queue" on the player): left up, it sits over the next screen's header for the rest of
 * its time. Errors, progress and toasts with a button (Undo) stay, since they are app-wide or still need the user.
 */
export function dropsOnRouteChange(toast: Pick<ToastData, 'kind' | 'action' | 'at'>, now: number): boolean {
  if (toast.kind !== 'info' && toast.kind !== 'success') return false;
  if (toast.action) return false;
  return now - toast.at >= ROUTE_CHANGE_GRACE_MS;
}
