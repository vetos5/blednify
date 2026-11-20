import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testServer, type TestServer } from "./fixtures";

let srv: TestServer;
let web: string;

beforeAll(() => {
  web = mkdtempSync(join(tmpdir(), "blednify-web-"));
  mkdirSync(join(web, "_expo/static/js"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Blednify</title>");
  writeFileSync(join(web, "_expo/static/js/app-abc.js"), "console.log(1)");
  writeFileSync(join(web, "manifest.webmanifest"), "{}");
  writeFileSync(join(web, "sw.js"), "self.addEventListener('fetch', () => {})");
  writeFileSync(join(tmpdir(), "blednify-secret.txt"), "secret");
  srv = testServer({}, { WEB_DIR: web, LISTEN_TOKEN: "t" });
});
afterAll(() => {
  srv.close();
  rmSync(web, { recursive: true, force: true });
});

describe("web app hosting", () => {
  test("serves the shell at / and for client routes, cross-origin isolated", async () => {
    for (const path of ["/", "/album/0123456789abcdef", "/settings"]) {
      const res = await srv.app.request(path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect(await res.text()).toContain("<title>Blednify</title>");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  test("hashed bundles are immutable; the manifest has its MIME type", async () => {
    const js = await srv.app.request("/_expo/static/js/app-abc.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("cache-control")).toContain("immutable");
    const mf = await srv.app.request("/manifest.webmanifest");
    expect(mf.headers.get("content-type")).toBe("application/manifest+json");
  });

  test("the offline shell's worker is revalidated on every launch, so a new one is picked up", async () => {
    const res = await srv.app.request("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("missing assets 404; the API is not shadowed; no path traversal", async () => {
    expect((await srv.app.request("/_expo/static/js/missing.js")).status).toBe(404);
    expect((await srv.app.request("/api/tracks")).status).toBe(401);
    expect((await srv.app.request("/api/nope")).status).toBe(401);
    const trav = await srv.app.request("/..%2fblednify-secret.txt");
    expect(await trav.text()).not.toContain("secret");
  });

  test("odd route paths still get the shell with a valid ETag (no 500)", async () => {
    const tags = new Set<string | null>();
    for (const path of ["/%D0%B0", "/album/%D0%9F%D0%BE%D1%88%D0%BB%D0%B0%D1%8F", '/foo"bar', "/%00"]) {
      const res = await srv.app.request(path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect(res.headers.get("etag")).toMatch(/^"[\x21\x23-\x7e]+"$/);
      tags.add(res.headers.get("etag"));
    }
    // Every route serves the same shell, so they share one tag.
    expect(tags.size).toBe(1);
  });

  test("hashed folders never fall back to the shell (it would be cached as immutable)", async () => {
    for (const path of ["/assets/whatever", "/assets/x.html", "/_expo/static/js/web/nonexistent"]) {
      const res = await srv.app.request(path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });

  test("without WEB_DIR nothing is served at /", async () => {
    const plain = testServer();
    try {
      expect((await plain.app.request("/")).status).toBe(404);
    } finally {
      plain.close();
    }
  });
});
