import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testServer } from "./fixtures";

// docs/API.md is the contract the app is written against. Every route the server answers must be in its
// Endpoints table, and every row there must be a route, so neither can drift without a failing test.
describe("docs/API.md", () => {
  const doc = readFileSync(join(import.meta.dir, "../../../docs/API.md"), "utf8");
  const documented = new Set(
    [...doc.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`?]+)[^`]*` \|/gm)].map(([, method, path]) => `${method} ${path}`),
  );

  test("lists exactly the server's /api routes", () => {
    const s = testServer({}, { LISTEN_TOKEN: "l", ADMIN_TOKEN: "a" });
    try {
      const served = new Set(
        s.app.routes.filter((r) => r.method !== "ALL" && r.path.startsWith("/api/")).map((r) => `${r.method} ${r.path}`),
      );
      expect([...documented].sort()).toEqual([...served].sort());
    } finally {
      s.close();
    }
  });
});
