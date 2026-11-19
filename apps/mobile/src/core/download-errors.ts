/** HTTP errors no retry can fix: the song is gone from the server (or moved), or the token is refused. */
const PERMANENT_STATUS = new Set([401, 403, 404, 410]);

/** The HTTP status in a native download error ("Unable to download a file: HTTP 404" / "response has status: 404"). */
export function httpStatusOf(message: string): number | null {
  const m = /(?:\bHTTP|\bstatus:?)\s*(\d{3})\b/i.exec(message);
  return m ? Number(m[1]) : null;
}

/**
 * Why a download failed, in words for its row. `permanent` when retrying can't help (only the user retries it then);
 * `auth` when the server refused the access token, so fixing the token in Settings retries it. Anything else
 * (dropped connection, server restarting, 5xx) is retried with backoff. The native text is for logs only: it reads
 * like "java.net.SocketTimeoutException: timeout".
 */
export function classifyDownloadError(message: string): { permanent: boolean; auth: boolean; message: string } {
  const status = httpStatusOf(message);
  if (status === 401 || status === 403) return { permanent: true, auth: true, message: 'The server refused the access token' };
  if (status !== null && PERMANENT_STATUS.has(status)) return { permanent: true, auth: false, message: 'No longer on the server' };
  return { permanent: false, auth: false, message: transientMessage(message, status) };
}

function transientMessage(message: string, status: number | null): string {
  if (status !== null && status >= 500) return 'Server error, try again later';
  if (/no space|ENOSPC|storage full|disk full/i.test(message)) return 'Phone storage is full';
  if (/timeout|timed out|connect|resolve host|network|socket|unreachable|abort|EOF|reset/i.test(message))
    return 'Connection lost';
  return 'Couldn’t download';
}
