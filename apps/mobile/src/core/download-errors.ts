/** HTTP errors no retry can fix: the song is gone from the server (or moved), or the token is refused. */
const PERMANENT_STATUS = new Set([401, 403, 404, 410]);

/** The HTTP status in a native download error ("Unable to download a file: HTTP 404" / "response has status: 404"). */
export function httpStatusOf(message: string): number | null {
  const m = /(?:\bHTTP|\bstatus:?)\s*(\d{3})\b/i.exec(message);
  return m ? Number(m[1]) : null;
}

/**
 * A failed download: `permanent` when retrying can't help (only the user retries it then), with words for the row.
 * Anything else (dropped connection, server restarting, 5xx) is retried with backoff.
 */
export function classifyDownloadError(message: string): { permanent: boolean; message: string } {
  const status = httpStatusOf(message);
  if (status === null || !PERMANENT_STATUS.has(status)) return { permanent: false, message };
  return {
    permanent: true,
    message: status === 401 || status === 403 ? 'The server refused the access token' : 'No longer on the server',
  };
}
