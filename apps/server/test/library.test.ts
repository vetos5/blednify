import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { testServer, type TestServer } from "./fixtures";

const KEY = "k".repeat(10) + "AbC_-123456789";
const OTHER = "z".repeat(30);
let srv: TestServer;

beforeAll(() => {
  srv = testServer();
});
afterAll(() => srv.close());

const call = (s: TestServer, method: string, headers: Record<string, string> = {}, body?: unknown) =>
  s.app.request("/api/library", {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const withKey = (key = KEY) => ({ "X-Library-Key": key });
const put = (baseVersion: unknown, data: unknown, key = KEY) => call(srv, "PUT", withKey(key), { baseVersion, data });

describe("library backup", () => {
  test("404 before anything is stored", async () => {
    const res = await call(srv, "GET", withKey());
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("create from baseVersion 0, then read it back", async () => {
    const data = { playlists: [{ id: "p1", name: "Mix", tracks: ["a", "b"] }], likes: ["a"] };
    const res = await put(0, data);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: 1, updatedAt: expect.any(String) });
    const got = await call(srv, "GET", withKey());
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toBe("no-store");
    expect(await got.json()).toEqual({ version: 1, updatedAt: expect.any(String), data });
  });

  test("update with the current version bumps it; a stale baseVersion is 409 with the current doc", async () => {
    const res = await put(1, { likes: ["a", "b"] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(2);
    const stale = await put(1, { likes: ["x"] });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ version: 2, updatedAt: expect.any(String), data: { likes: ["a", "b"] } });
    const ahead = await put(5, { likes: ["x"] });
    expect(ahead.status).toBe(409);
    expect(((await (await call(srv, "GET", withKey())).json()) as { data: unknown }).data).toEqual({ likes: ["a", "b"] });
  });

  test("baseVersion 0 on an existing library conflicts; on a missing one the 409 has null data", async () => {
    expect((await put(0, {})).status).toBe(409);
    const fresh = await put(3, {}, "n".repeat(25));
    expect(fresh.status).toBe(409);
    expect(await fresh.json()).toEqual({ version: 0, updatedAt: null, data: null });
  });

  test("different keys are isolated", async () => {
    expect((await put(0, { who: "other" }, OTHER)).status).toBe(200);
    const mine = (await (await call(srv, "GET", withKey())).json()) as { data: unknown };
    const theirs = (await (await call(srv, "GET", withKey(OTHER))).json()) as { version: number; data: unknown };
    expect(mine.data).toEqual({ likes: ["a", "b"] });
    expect(theirs).toMatchObject({ version: 1, data: { who: "other" } });
  });

  test("invalid or missing key is 400", async () => {
    for (const key of ["short", "x".repeat(129), "has space in it 1234567890", "bad/chars/1234567890123456"]) {
      expect({ key, status: (await call(srv, "GET", withKey(key))).status }).toEqual({ key, status: 400 });
      expect((await put(0, {}, key)).status).toBe(400);
      expect((await call(srv, "DELETE", withKey(key))).status).toBe(400);
    }
    for (const method of ["GET", "DELETE"]) expect((await call(srv, method)).status).toBe(400);
    const res = await call(srv, "PUT", {}, { baseVersion: 0, data: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  test("bad body is 400", async () => {
    const k = "b".repeat(24);
    for (const data of [[], "str", 5, null, [{}]]) expect({ data, status: (await put(0, data, k)).status }).toEqual({ data, status: 400 });
    for (const base of [-1, 1.5, "0", null, undefined]) expect({ base, status: (await put(base, {}, k)).status }).toEqual({ base, status: 400 });
    expect((await call(srv, "PUT", withKey(k), "not json")).status).toBe(400);
    expect((await call(srv, "PUT", withKey(k), { baseVersion: 0 })).status).toBe(400);
    expect((await call(srv, "GET", withKey(k))).status).toBe(404);
  });

  test("a body over 8 MiB is 413", async () => {
    const big = JSON.stringify({ baseVersion: 0, data: { blob: "x".repeat(8 * 1024 * 1024) } });
    const res = await call(srv, "PUT", withKey("c".repeat(24)), big);
    expect(res.status).toBe(413);
    const noLength = await srv.app.request("/api/library", {
      method: "PUT",
      headers: withKey("c".repeat(24)),
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(big));
          ctrl.close();
        },
      }),
      duplex: "half",
    });
    expect(noLength.status).toBe(413);
  });

  test("delete is idempotent and the library is gone afterwards", async () => {
    expect((await call(srv, "DELETE", withKey())).status).toBe(204);
    expect((await call(srv, "DELETE", withKey())).status).toBe(204);
    expect((await call(srv, "GET", withKey())).status).toBe(404);
    expect((await put(0, { again: true })).status).toBe(200);
  });

  test("the raw key is never stored; the id is its sha256", () => {
    const hash = createHash("sha256").update(KEY).digest("hex");
    const rows = srv.ctx.db.sql.query("SELECT * FROM libraries").all() as { id: string }[];
    expect(rows.map((r) => r.id)).toContain(hash);
    expect(JSON.stringify(rows)).not.toContain(KEY);
    srv.ctx.db.sql.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const file = readFileSync(join(srv.dataDir, "blednify.db"));
    expect(file.includes(Buffer.from(KEY))).toBe(false);
    const ro = new Database(join(srv.dataDir, "blednify.db"), { readonly: true });
    expect(ro.query("SELECT id FROM libraries WHERE id = ?").get(hash)).not.toBeNull();
    ro.close();
  });

  test("ADMIN_TOKEN and ALLOW_OPEN_WRITES do not affect it", async () => {
    const s = testServer({}, { ADMIN_TOKEN: "admin-xyz", ALLOW_OPEN_WRITES: "" });
    try {
      const res = await call(s, "PUT", withKey(), { baseVersion: 0, data: { a: 1 } });
      expect(res.status).toBe(200);
      expect((await call(s, "DELETE", withKey())).status).toBe(204);
    } finally {
      s.close();
    }
  });
});

describe("library backup with a listen token", () => {
  const TOKEN = "listen-secret-123";
  const auth = { Authorization: `Bearer ${TOKEN}` };
  let guarded: TestServer;
  beforeAll(() => {
    guarded = testServer({}, { LISTEN_TOKEN: TOKEN, ALLOW_OPEN_WRITES: "" });
  });
  afterAll(() => guarded.close());

  test("every method needs the token", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const body = method === "PUT" ? { baseVersion: 0, data: {} } : undefined;
      const none = await call(guarded, method, withKey(), body);
      expect({ method, status: none.status }).toEqual({ method, status: 401 });
      expect(none.headers.get("www-authenticate")).toContain("Bearer");
      expect((await call(guarded, method, { ...withKey(), Authorization: "Bearer wrong" }, body)).status).toBe(401);
    }
  });

  test("with the bearer token it works, without ADMIN_TOKEN", async () => {
    const headers = { ...withKey(), ...auth };
    expect((await call(guarded, "PUT", headers, { baseVersion: 0, data: { likes: [] } })).status).toBe(200);
    expect(await (await call(guarded, "GET", headers)).json()).toMatchObject({ version: 1, data: { likes: [] } });
    expect((await call(guarded, "DELETE", headers)).status).toBe(204);
    expect((await call(guarded, "GET", headers)).status).toBe(404);
  });
});

describe("library backup concurrency", () => {
  test("two pushes from the same base: one wins, the other gets the winner copy", async () => {
    const key = "q".repeat(30);
    const [a, b] = await Promise.all([put(0, { who: "a" }, key), put(0, { who: "b" }, key)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const body = (await (a.status === 409 ? a : b).json()) as { version: number; data: unknown };
    const stored = (await (await call(srv, "GET", withKey(key))).json()) as { data: unknown };
    expect(body.version).toBe(1);
    expect(body.data).toEqual(stored.data);
  });
});
