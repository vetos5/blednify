import { describe, expect, test } from 'bun:test';

import { dropsOnRouteChange, ROUTE_CHANGE_GRACE_MS } from '../src/ui/toast-scope';

describe('dropsOnRouteChange', () => {
  const at = 1_000;
  const later = at + ROUTE_CHANGE_GRACE_MS + 1;

  test('an info or success note raised on the screen being left goes', () => {
    expect(dropsOnRouteChange({ kind: 'info', at }, later)).toBe(true);
    expect(dropsOnRouteChange({ kind: 'success', at }, later)).toBe(true);
  });

  test('a note raised as part of the navigation itself stays for the next screen', () => {
    expect(dropsOnRouteChange({ kind: 'success', at }, at + 50)).toBe(false);
  });

  test('errors, progress and toasts with a button stay', () => {
    expect(dropsOnRouteChange({ kind: 'error', at }, later)).toBe(false);
    expect(dropsOnRouteChange({ kind: 'progress', at }, later)).toBe(false);
    expect(dropsOnRouteChange({ kind: 'info', at, action: { label: 'Undo', onPress: () => {} } }, later)).toBe(false);
  });
});
