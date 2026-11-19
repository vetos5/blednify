// Pure host classification (no native imports), so it can be unit-tested.

/** Host part of a URL or schemeless address ("host", "host:port", "[v6]:port"), lowercased. */
function hostOf(address: string): string {
  const rest = address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0].replace(/^[^@]*@/, '');
  const v6 = /^\[([^\]]+)\]/.exec(rest);
  return (v6 ? v6[1] : rest.replace(/:\d*$/, '')).toLowerCase();
}

/**
 * A host that is only reachable on this network (or the phone itself): localhost, IP literals in private ranges,
 * single-label names and .local/.lan/.home.arpa/.internal names. Plain http there doesn't cross the internet.
 */
export function isLocalHost(address: string): boolean {
  const h = hostOf(address);
  if (!h) return false;
  if (h.includes(':')) return isLocalV6(h);
  if (h === 'localhost' || !h.includes('.')) return true; // single label
  if (/\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(h)) return true;
  return isLocalV4(h);
}

/** IPv6 literal: loopback, link-local fe80::/10, unique-local fc00::/7 (Tailscale's fd7a:115c:a1e0::/48 is one). */
function isLocalV6(h: string): boolean {
  const v6 = h.replace(/%.*$/, ''); // zone id (fe80::1%wlan0)
  if (v6 === '::1' || v6 === '::') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isLocalV4(mapped[1]);
  return /^fe[89ab][0-9a-f]:/.test(v6) || /^f[cd][0-9a-f]{2}:/.test(v6);
}

function isLocalV4(h: string): boolean {
  const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  // 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 link-local, 100.64/10 (CGNAT: Tailscale).
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** The server URL sends tokens in cleartext over the internet (http:// to a public host). */
export const isCleartextPublic = (url: string): boolean => /^http:\/\//i.test(url) && !isLocalHost(url);

/**
 * Canonical base URL: trimmed, scheme added if missing, no trailing slash. Empty ⇒ offline mode. A schemeless
 * address gets http:// on the local network and https:// otherwise, so a token never goes out in cleartext by
 * default.
 */
export function normalizeServerUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
  return `${isLocalHost(u) ? 'http' : 'https'}://${u}`;
}
