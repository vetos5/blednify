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
 * Who is asking. Behind Cloudflare (the usual way this server is reached) every request arrives from the tunnel,
 * so the visitor's address is in CF-Connecting-IP (which Cloudflare overwrites, a client can't forge it there).
 * Otherwise the first X-Forwarded-For hop, then the socket's address.
 */
export function clientKey(headers: { get(name: string): string | null }, socketAddress: string | undefined): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  return socketAddress ?? "unknown";
}
