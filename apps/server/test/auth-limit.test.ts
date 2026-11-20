import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  AUTH_MAX_DISTINCT,
  AUTH_WINDOW_MS,
  AuthLimiter,
  clientKey,
  DEFAULT_TRUSTED_PROXIES,
  isTrusted,
  parseTrustedProxies,
} from "../src/auth-limit";
import { testServer, type TestServer } from "./fixtures";

describe("AuthLimiter", () => {
  test("distinct wrong tokens lock a client out until the window passes", () => {
    const l = new AuthLimiter(3, 1000);
    l.fail("a", "t1", 0);
    l.fail("a", "t2", 10);
    expect(l.retryAfterMs("a", 20)).toBe(0);
    l.fail("a", "t3", 20);
    expect(l.retryAfterMs("a", 30)).toBe(970);
    expect(l.retryAfterMs("b", 30)).toBe(0);
    expect(l.retryAfterMs("a", 1000)).toBe(0);
  });

  test("the same wrong token repeated (a phone with an old token) never locks", () => {
    const l = new AuthLimiter(3, 1000);
    for (let i = 0; i < 100; i++) l.fail("a", "old-token", i);
    expect(l.retryAfterMs("a", 100)).toBe(0);
  });
});

describe("trusted proxies", () => {
  test("keywords, CIDRs and single addresses, IPv4-mapped included", () => {
    const t = parseTrustedProxies("loopback, 100.64.0.0/10 fd7a:115c:a1e0::/48 203.0.113.7");
    for (const a of ["127.0.0.1", "127.9.9.9", "::1", "::ffff:127.0.0.1", "100.101.102.103", "fd7a:115c:a1e0::1", "203.0.113.7"])
      expect(isTrusted(t, a)).toBe(true);
    for (const a of ["10.0.0.1", "192.168.1.5", "100.128.0.1", "fd7a:115c:a1e1::1", "203.0.113.8", "::2", "nonsense", undefined])
      expect(isTrusted(t, a)).toBe(false);
  });

  test("the default trusts the host and private networks (a tunnel in another container), not the internet or Tailscale", () => {
    const t = parseTrustedProxies(DEFAULT_TRUSTED_PROXIES);
    for (const a of ["127.0.0.1", "172.18.0.3", "::ffff:172.18.0.3", "10.1.2.3", "192.168.0.10", "fd00::5"])
      expect(isTrusted(t, a)).toBe(true);
    for (const a of ["8.8.8.8", "172.32.0.1", "100.101.102.103", "2001:db8::1"]) expect(isTrusted(t, a)).toBe(false);
    expect(parseTrustedProxies("none")).toEqual({ v4: [], v6: [] });
  });

  test("a typo fails loudly instead of trusting nothing (or everything)", () => {
    for (const bad of ["lan", "10.0.0.0/33", "1.2.3.256", "fe80::1::2", "10.0.0.0/8/1"])
      expect(() => parseTrustedProxies(bad)).toThrow(/TRUSTED_PROXIES/);
  });
});

describe("clientKey", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const trusted = parseTrustedProxies("private");
  test("from a trusted proxy: Cloudflare's visitor address, then the nearest untrusted forwarded hop", () => {
    expect(clientKey(h({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), "172.18.0.3", trusted)).toBe("1.2.3.4");
    // The client wrote 6.6.6.6 itself; 5.6.7.8 is what the proxy saw.
    expect(clientKey(h({ "x-forwarded-for": "6.6.6.6, 5.6.7.8, 10.0.0.1" }), "127.0.0.1", trusted)).toBe("5.6.7.8");
    expect(clientKey(h({ "x-forwarded-for": "10.0.0.9" }), "127.0.0.1", trusted)).toBe("10.0.0.9");
    expect(clientKey(h({}), "127.0.0.1", trusted)).toBe("127.0.0.1");
  });

  test("from anyone else the headers are ignored: the socket address is the client", () => {
    expect(clientKey(h({ "cf-connecting-ip": "1.2.3.4" }), "100.101.102.103", trusted)).toBe("100.101.102.103");
    expect(clientKey(h({ "x-forwarded-for": "5.6.7.8" }), "8.8.8.8", trusted)).toBe("8.8.8.8");
    expect(clientKey(h({ "cf-connecting-ip": "1.2.3.4" }), undefined, trusted)).toBe("unknown");
    expect(clientKey(h({ "cf-connecting-ip": "1.2.3.4" }), "127.0.0.1", parseTrustedProxies("none"))).toBe("127.0.0.1");
  });
});

describe("token guessing over HTTP", () => {
  const TOKEN = "listen-secret-123";
  let srv: TestServer;
  beforeAll(() => {
    srv = testServer({}, { LISTEN_TOKEN: TOKEN, ADMIN_TOKEN: "admin-secret-456" });
  });
  afterAll(() => srv.close());
  /** Bun's server as Hono sees it: the socket address of the request. */
  const from = (address: string) => ({ requestIP: () => ({ address }) });
  const TUNNEL = "172.18.0.3";
  const get = (path: string, token: string, ip: string, socket = TUNNEL) =>
    srv.app.request(path, { headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": ip } }, from(socket));

  test("after too many distinct wrong tokens even the right one gets 429, other clients are unaffected", async () => {
    for (let i = 0; i < AUTH_MAX_DISTINCT; i++) expect((await get("/api/tracks", `guess-${i}`, "6.6.6.6")).status).toBe(401);
    const locked = await get("/api/tracks", TOKEN, "6.6.6.6");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(locked.headers.get("retry-after"))).toBeLessThanOrEqual(AUTH_WINDOW_MS / 1000);
    expect((await get("/api/tracks", TOKEN, "7.7.7.7")).status).toBe(200);
  });

  test("admin guesses count too", async () => {
    for (let i = 0; i < AUTH_MAX_DISTINCT; i++) {
      const res = await srv.app.request(
        "/api/admin/check",
        { method: "POST", headers: { Authorization: `Bearer admin-guess-${i}`, "CF-Connecting-IP": "8.8.4.4" } },
        from(TUNNEL),
      );
      expect(res.status).toBe(401);
    }
    const res = await srv.app.request(
      "/api/admin/check",
      { method: "POST", headers: { Authorization: "Bearer admin-secret-456", "CF-Connecting-IP": "8.8.4.4" } },
      from(TUNNEL),
    );
    expect(res.status).toBe(429);
  });

  test("a stale token polled again and again keeps getting 401, never 429", async () => {
    for (let i = 0; i < AUTH_MAX_DISTINCT * 3; i++) expect((await get("/api/health", "old-token", "9.9.9.9")).status).toBe(401);
    expect((await get("/api/health", TOKEN, "9.9.9.9")).status).toBe(200);
  });

  test("a peer that isn't a proxy can't buy new tries by rotating CF-Connecting-IP or X-Forwarded-For", async () => {
    const lan = "100.70.0.9";
    for (let i = 0; i < AUTH_MAX_DISTINCT; i++) {
      const spoof: Record<string, string> = i % 2 ? { "CF-Connecting-IP": `203.0.113.${i}` } : { "X-Forwarded-For": `198.51.100.${i}` };
      const res = await srv.app.request("/api/tracks", { headers: { Authorization: `Bearer rot-${i}`, ...spoof } }, from(lan));
      expect(res.status).toBe(401);
    }
    expect((await get("/api/tracks", "rot-next", "203.0.113.200", lan)).status).toBe(429);
  });

  test("a peer that isn't a proxy can't lock someone else out by naming their address", async () => {
    const victim = "192.0.2.44";
    for (let i = 0; i < AUTH_MAX_DISTINCT; i++)
      expect((await get("/api/tracks", `frame-${i}`, victim, "100.70.0.10")).status).toBe(401);
    // The guesses were pinned on the guesser's own socket; the victim, coming through the tunnel, is fine.
    expect((await get("/api/tracks", TOKEN, victim)).status).toBe(200);
  });
});
