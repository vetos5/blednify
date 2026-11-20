import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { AUTH_MAX_DISTINCT, AUTH_WINDOW_MS, AuthLimiter, clientKey } from "../src/auth-limit";
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

describe("clientKey", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  test("Cloudflare's visitor address, then the first forwarded hop, then the socket", () => {
    expect(clientKey(h({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), "127.0.0.1")).toBe("1.2.3.4");
    expect(clientKey(h({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }), "127.0.0.1")).toBe("5.6.7.8");
    expect(clientKey(h({}), "127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("token guessing over HTTP", () => {
  const TOKEN = "listen-secret-123";
  let srv: TestServer;
  beforeAll(() => {
    srv = testServer({}, { LISTEN_TOKEN: TOKEN, ADMIN_TOKEN: "admin-secret-456" });
  });
  afterAll(() => srv.close());
  const get = (path: string, token: string, ip: string) =>
    srv.app.request(path, { headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": ip } });

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
      const res = await srv.app.request("/api/admin/check", {
        method: "POST",
        headers: { Authorization: `Bearer admin-guess-${i}`, "CF-Connecting-IP": "8.8.4.4" },
      });
      expect(res.status).toBe(401);
    }
    const res = await srv.app.request("/api/admin/check", {
      method: "POST",
      headers: { Authorization: "Bearer admin-secret-456", "CF-Connecting-IP": "8.8.4.4" },
    });
    expect(res.status).toBe(429);
  });

  test("a stale token polled again and again keeps getting 401, never 429", async () => {
    for (let i = 0; i < AUTH_MAX_DISTINCT * 3; i++) expect((await get("/api/health", "old-token", "9.9.9.9")).status).toBe(401);
    expect((await get("/api/health", TOKEN, "9.9.9.9")).status).toBe(200);
  });
});
