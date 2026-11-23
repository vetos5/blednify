/**
 * When the player treats the phone as offline (plays only downloads) and when it goes back to streaming. Pure (no
 * native imports), so the policy is unit-tested (test/reach.test.ts); engine.ts supplies the network state and runs
 * the server probe this asks for.
 *
 * A server on the internet is judged by the phone's own reachability. A LAN or Tailscale server (`local`) isn't:
 * "no internet" on home Wi-Fi says nothing about it, and "connected" on mobile data doesn't mean it answers. For
 * such a server the player asks the server itself (a quick GET /api/health) where the network state can't tell.
 */
export type NetState = { isConnected?: boolean | null; isInternetReachable?: boolean | null; type?: string | null };

/** `probe`: ask the server; it is offline (for this server) when the probe fails. */
export type Verdict = 'offline' | 'online' | 'probe';

/**
 * A streamed song just failed on the network: should the player move on to downloads? `online` keeps retrying the
 * song in place (a connection or server that may come back any moment).
 * - No connection at all, or no internet while the server is on the internet: offline.
 * - A LAN server while on mobile data: only reachable over a VPN such as Tailscale, so ask it.
 * - A LAN server on Wi-Fi or Ethernet: keep retrying (a server restart shouldn't drop to downloads).
 */
export function offlineVerdict(net: NetState, local: boolean): Verdict {
  if (net.isConnected === false) return 'offline';
  if (!local) return net.isInternetReachable === false ? 'offline' : 'online';
  return net.type === 'CELLULAR' ? 'probe' : 'online';
}

/**
 * While playing only downloads: is the server back? Connected and the internet answers, for a server on the
 * internet (right after Wi-Fi associates reachability is often still unknown, or a captive portal holds it). A LAN
 * server must answer the probe itself: being connected to mobile data is not enough.
 */
export function backOnlineVerdict(net: NetState, local: boolean): Verdict {
  if (net.isConnected !== true) return 'offline';
  if (local) return 'probe';
  return net.isInternetReachable === true ? 'online' : 'offline';
}

/** How often a LAN server is asked whether it is back while the player sticks to downloads. */
export const LAN_REPROBE_MS = 60_000;
/** A probe that takes longer than this counts as no answer. */
export const PROBE_TIMEOUT_MS = 3_000;

/**
 * While a dropped connection is retried on a streamed song, the server is asked this often whether it is back. A LAN
 * or localhost server coming back changes nothing in the phone's network state, so only the 2/4/8/15/30 s backoff
 * noticed it: playback resumed 7.5-15.5 s (up to 30 s) after the server answered again.
 */
export const RETRY_PROBE_MS = 2_000;

/**
 * Whether a health probe during a network retry should retry the song now. Only when the server *starts* answering
 * (it didn't on the probe before) and a backoff wait is running (no attempt under way): a server that answers health
 * while the stream still fails (a broken proxy) keeps the backoff instead of being retried every probe.
 */
export function probeRetriesNow({ answers, answeredBefore, waiting }: { answers: boolean; answeredBefore: boolean; waiting: boolean }): boolean {
  return answers && !answeredBefore && waiting;
}
