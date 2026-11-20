import { useNetworkState } from 'expo-network';

import { useServerStatus } from './catalog';
import { connectionOf, type Connection } from './connection-state';

export { connectionLabel, unreachablePrefix, type Connection } from './connection-state';

/** The server's status plus whether the phone itself is offline, folded into one `Connection` (see connection-state). */
export function useConnection(): { state: Connection; phoneOffline: boolean; trackCount: number; serverUrl: string } {
  const server = useServerStatus();
  const phoneOffline = useNetworkState().isConnected === false;
  const state = connectionOf({
    hasServer: server.serverUrl.length > 0,
    online: server.online,
    loading: server.isLoading,
    needsToken: server.needsToken,
    phoneOffline,
  });
  return { state, phoneOffline, trackCount: server.trackCount, serverUrl: server.serverUrl };
}
