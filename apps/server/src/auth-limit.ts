/**
 * Slows down token guessing. The listen and admin tokens are the only thing between the internet and the library,
 * so a client that keeps presenting wrong tokens is turned away for a while.
 *
 * Only *distinct* wrong tokens count: a phone still polling with an old token after the server's token changed
 * repeats the same one and never locks itself (or its owner's network) out, while guessing needs a new token
 * every try. Once a client is over the limit every request that carries a credential gets 429, the right token
 * included: answering it differently would tell a guesser it had found it.
 */
import { createHash } from "node:crypto";

/** Distinct wrong tokens a client may present per window. */
export const AUTH_MAX_DISTINCT = 20;
export const AUTH_WINDOW_MS = 15 * 60_000;
/** Clients tracked at most; the stalest are forgotten first. */
const MAX_CLIENTS = 10_000;

export class AuthLimiter {
  /** client → wrong-token fingerprint → when it was last presented. */
  private readonly fails = new Map<string, Map<string, number>>();

  constructor(
    private readonly max = AUTH_MAX_DISTINCT,
    private readonly windowMs = AUTH_WINDOW_MS,
  ) {}

  /** Milliseconds until `client` may try again, or 0 when it isn't limited. */
  retryAfterMs(client: string, now = Date.now()): number {
    const seen = this.prune(client, now);
    if (!seen || seen.size < this.max) return 0;
    const oldest = Math.min(...seen.values());
    return Math.max(1, oldest + this.windowMs - now);
  }

  /** `client` presented `credential` and it was refused. */
  fail(client: string, credential: string, now = Date.now()): void {
    let seen = this.prune(client, now);
    if (!seen) {
      if (this.fails.size >= MAX_CLIENTS) this.fails.delete(this.fails.keys().next().value!);
      seen = new Map();
    } else this.fails.delete(client); // re-inserted below: most recently failing last
    this.fails.set(client, seen);
    seen.set(createHash("sha256").update(credential).digest("base64"), now);
  }

  private prune(client: string, now: number): Map<string, number> | undefined {
    const seen = this.fails.get(client);
    if (!seen) return undefined;
    for (const [k, at] of seen) if (now - at >= this.windowMs) seen.delete(k);
    if (seen.size === 0) {
      this.fails.delete(client);
      return undefined;
    }
    return seen;
  }
}

/**
 * Peers whose CF-Connecting-IP / X-Forwarded-For headers are believed (TRUSTED_PROXIES). Anyone else could put any
 * address there: rotating it would make every guess a "new client", and naming someone else's address would lock
 * them out. So a request from any other peer is keyed on its socket address and its headers are ignored.
 *
 * Entries are CIDRs ("10.0.0.0/8", "fd7a::/48"), single addresses, or the words `loopback` (127.0.0.0/8, ::1),
 * `private` (loopback plus 10/8, 172.16/12, 192.168/16, fc00::/7: where a tunnel or reverse proxy in another
 * container on the same host connects from) and `none`.
 */
export type TrustedProxies = { v4: [number, number][]; v6: [bigint, bigint][] };

const KEYWORDS: Record<string, string[]> = {
  none: [],
  loopback: ["127.0.0.0/8", "::1/128"],
  private: ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

/** The default: the Cloudflare tunnel runs in its own container, so it connects from a private address. */
export const DEFAULT_TRUSTED_PROXIES = "private";

function v4(addr: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (!m) return null;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function v6(addr: string): bigint | null {
  if (!addr.includes(":") || addr.includes("%")) return null;
  let tail: number[] = [];
  let a = addr;
  const dotted = /:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted?.[1]) {
    const n = v4(dotted[1]);
    if (n === null) return null;
    tail = [n >>> 16, n & 0xffff];
    a = a.slice(0, -dotted[1].length) + "0:0";
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  const groups = [...head, ...Array<number>(halves.length === 2 ? fill : 0).fill(0), ...rest];
  if (tail.length) groups.splice(6, 2, ...tail);
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

/** An IPv4 address, also when written IPv4-mapped ("::ffff:172.18.0.3", how a dual-stack socket reports it). */
function asV4(addr: string): number | null {
  const direct = v4(addr);
  if (direct !== null) return direct;
  const n = v6(addr);
  return n !== null && n >> 32n === 0xffffn ? Number(n & 0xffffffffn) : null;
}

export function parseTrustedProxies(spec: string): TrustedProxies {
  const out: TrustedProxies = { v4: [], v6: [] };
  for (const raw of spec.split(/[\s,]+/).filter(Boolean)) {
    const word = KEYWORDS[raw.toLowerCase()];
    for (const entry of word ?? [raw]) {
      const [addr = "", bitsRaw, extra] = entry.split("/");
      const a4 = v4(addr);
      const a6 = a4 === null ? v6(addr) : null;
      const max = a4 !== null ? 32 : 128;
      const bits = bitsRaw === undefined ? max : Number(bitsRaw);
      if ((a4 === null && a6 === null) || extra !== undefined || !Number.isInteger(bits) || bits < 0 || bits > max)
        throw new Error(`TRUSTED_PROXIES: "${raw}" is not an address, a CIDR, or one of none, loopback, private`);
      if (a4 !== null) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        out.v4.push([(a4 & mask) >>> 0, mask]);
      } else {
        const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
        out.v6.push([a6! & mask, mask]);
      }
    }
  }
  return out;
}

export function isTrusted(trusted: TrustedProxies, addr: string | undefined): boolean {
  if (!addr) return false;
  const a4 = asV4(addr);
  if (a4 !== null) return trusted.v4.some(([net, mask]) => ((a4 & mask) >>> 0) === net);
  const a6 = v6(addr);
  return a6 !== null && trusted.v6.some(([net, mask]) => (a6 & mask) === net);
}

/**
 * Who is asking. A request from a trusted proxy (the Cloudflare tunnel, a reverse proxy) is keyed on the visitor
 * address it reports: CF-Connecting-IP (Cloudflare sets it), else the nearest X-Forwarded-For hop that isn't itself
 * a trusted proxy (hops further left are whatever the client wrote). Any other request is keyed on its socket
 * address, whatever its headers say.
 */
export function clientKey(
  headers: { get(name: string): string | null },
  socketAddress: string | undefined,
  trusted: TrustedProxies,
): string {
  const socket = socketAddress ?? "unknown";
  if (!isTrusted(trusted, socketAddress)) return socket;
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (i === 0 || !isTrusted(trusted, hop)) return hop;
  }
  return socket;
}
