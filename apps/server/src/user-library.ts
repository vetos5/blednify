import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Db } from "./db";

const KEY_RE = /^[A-Za-z0-9_-]{20,128}$/;
export const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
/**
 * New keys are refused (507) past these totals: a personal server has a handful of devices, and with open reads
 * (no LISTEN_TOKEN) anyone reaching it could otherwise fill DATA_DIR with 8 MiB documents under random keys.
 */
export const MAX_LIBRARIES = 500;
export const MAX_LIBRARIES_TOTAL_BYTES = 256 * 1024 * 1024;

type Fail = (status: 400 | 401 | 404 | 413, error: string) => never;
type Row = { version: number; data: string; updated_at: string };

const putBody = z.object({ baseVersion: z.number().int().min(0), data: z.record(z.string(), z.unknown()) });

/**
 * Per-install backup of the app's playlists and likes, stored as an opaque JSON object under the sha256 of a
 * random secret key sent in `X-Library-Key`. `listenOk` is null when reads are open (no listen token).
 */
export function userLibraryRoutes(db: Db, listenOk: ((c: Context) => boolean) | null, fail: Fail): Hono {
  const r = new Hono();
  const { sql } = db;
  const read = sql.query<Row, [string]>("SELECT version, data, updated_at FROM libraries WHERE id = ?");
  const insert = sql.query("INSERT INTO libraries (id, version, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  const update = sql.query("UPDATE libraries SET version = ?, data = ?, updated_at = ? WHERE id = ?");
  const remove = sql.query("DELETE FROM libraries WHERE id = ?");
  const totals = sql.query<{ n: number; bytes: number | null }, []>("SELECT COUNT(*) AS n, SUM(length(data)) AS bytes FROM libraries");

  // The global listen guard covers GET/HEAD only; this one covers every method.
  r.use("*", async (c, next) => {
    if (listenOk && !listenOk(c)) {
      c.header("WWW-Authenticate", 'Bearer realm="blednify"');
      fail(401, "unauthorized");
    }
    c.header("Cache-Control", "no-store");
    await next();
  });

  const idOf = (c: Context): string => {
    const key = c.req.header("x-library-key") ?? "";
    if (!KEY_RE.test(key)) fail(400, "X-Library-Key must be 20-128 characters of A-Z a-z 0-9 _ -");
    return createHash("sha256").update(key).digest("hex");
  };
  const doc = (row: Row) => ({ version: row.version, updatedAt: row.updated_at, data: JSON.parse(row.data) as unknown });

  r.get("/", (c) => {
    const row = read.get(idOf(c));
    return row ? c.json(doc(row)) : fail(404, "no library stored for this key");
  });

  r.put(
    "/",
    bodyLimit({ maxSize: MAX_LIBRARY_BYTES, onError: () => fail(413, "library exceeds 8 MiB") }),
    async (c) => {
      const id = idOf(c);
      const body = putBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) fail(400, "expected JSON { baseVersion: integer >= 0, data: object }");
      const { baseVersion, data } = body.data!;
      const text = JSON.stringify(data);
      const now = new Date().toISOString();
      const result = sql.transaction(() => {
        const current = read.get(id);
        const version = current?.version ?? 0;
        if (baseVersion !== version) return { conflict: current ? doc(current) : { version: 0, updatedAt: null, data: null } };
        if (current) update.run(version + 1, text, now, id);
        else {
          const t = totals.get()!;
          if (t.n >= MAX_LIBRARIES || (t.bytes ?? 0) + text.length > MAX_LIBRARIES_TOTAL_BYTES) return { full: true as const };
          insert.run(id, 1, text, now, now);
        }
        return { ok: { version: version + 1, updatedAt: now } };
      }).immediate();
      if ("full" in result) return c.json({ error: "server has no room for another library backup" }, 507);
      return "conflict" in result ? c.json(result.conflict, 409) : c.json(result.ok);
    },
  );

  r.delete("/", (c) => {
    remove.run(idOf(c));
    return c.body(null, 204);
  });

  return r;
}
