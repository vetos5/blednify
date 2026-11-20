/**
 * One answer to "can this app reach its music right now?", shared by every place that says so (Home's pill and
 * notice, the desktop sidebar, Library and Search notes). Pure: no React Native imports, so it is unit-tested.
 *
 * The phone having no connection at all wins over "server offline": the address is not what needs fixing then,
 * and saying "Server offline" sends the user to Settings for nothing.
 */
export type Connection =
  /** No server configured: a local-only library. */
  | 'none'
  | 'connecting'
  | 'online'
  /** The phone itself has no network (airplane mode, no signal). */
  | 'phone-offline'
  /** The server wants an access token and none is set. */
  | 'needs-token'
  /** The phone is online (or can't tell) but the server doesn't answer. */
  | 'server-offline';

export type ConnectionInput = {
  hasServer: boolean;
  online: boolean;
  loading: boolean;
  needsToken: boolean;
  /** `isConnected === false` from the OS; unknown (null/undefined) is not offline. */
  phoneOffline: boolean;
};

export function connectionOf({ hasServer, online, loading, needsToken, phoneOffline }: ConnectionInput): Connection {
  if (!hasServer) return 'none';
  // A LAN server can still answer with the radio off (e.g. a USB tether): a success is the truth.
  if (online) return 'online';
  if (phoneOffline) return 'phone-offline';
  if (loading) return 'connecting';
  if (needsToken) return 'needs-token';
  return 'server-offline';
}

/** Status line under Home's greeting (and the sidebar's, with `short`). */
export function connectionLabel(c: Connection, trackCount: number, opts: { short?: boolean; downloads?: boolean } = {}): string {
  switch (c) {
    case 'none':
      return opts.short ? 'No server' : 'Local library';
    case 'connecting':
      return 'Connecting…';
    case 'online':
      return opts.short ? `${trackCount.toLocaleString()} ${trackCount === 1 ? 'song' : 'songs'}` : `Server · ${trackCount.toLocaleString()} songs`;
    case 'phone-offline':
      return opts.short || !opts.downloads ? 'You’re offline' : 'Offline · downloads still play';
    case 'needs-token':
      return opts.short ? 'Needs a token' : 'Server needs a token';
    case 'server-offline':
      return 'Server offline';
  }
}

/** Prefix of the notes above on-phone results when server results can't be shown ("… · albums on this phone"). */
export function unreachablePrefix(why: false | 'offline' | 'refused', phoneOffline: boolean): string {
  if (why === 'refused') return 'Access token refused';
  return phoneOffline ? 'You’re offline' : 'Server offline';
}
