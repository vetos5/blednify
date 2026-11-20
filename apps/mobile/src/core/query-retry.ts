/**
 * Whether a failed server query is tried once more. Pure (test/query-retry.test.ts).
 *
 * - An HTTP answer that won't change on its own (400-499: a refused token, a song that is gone) is final.
 * - A connection failure while the server is already known to be unreachable (its health check failed) is final
 *   too: the status line says so, and with the radios off every screen and every song change otherwise fired each
 *   query twice, a second apart, into a dead socket.
 * - Anything else (a dropped request, a 502 from a tunnel that blinked) gets one more try.
 */
export function shouldRetryQuery(failureCount: number, error: unknown, serverDown: boolean): boolean {
  if (failureCount >= 1) return false;
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status: unknown }).status : null;
  if (typeof status === 'number') return status < 400 || status >= 500;
  return !serverDown;
}
