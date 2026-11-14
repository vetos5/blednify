import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { serveFile } from "./serve-file";

/**
 * Static hosting for the web app (installable on iOS from Safari: Share → Add to Home Screen).
 *
 * Every response is cross-origin isolated (COOP + COEP): expo-sqlite's web build needs SharedArrayBuffer. No page
 * may frame it.
 * Hashed bundles are immutable; index.html and the manifest are revalidated so updates land on next launch.
 * Unknown paths without an extension fall back to index.html (client-side routes like /album/123).
 */
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  // Never framed by another site (clickjacking of admin actions such as delete).
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
} as const;

const TYPES: Record<string, string> = {
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function serveWeb(req: Request, dir: string): Promise<Response | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return null;
  }
  const root = normalize(dir + sep);
  const target = normalize(join(root, rel));
  if (!target.startsWith(root)) return null;

  const inHashedDir = rel.startsWith("/_expo/") || rel.startsWith("/assets/");
  let path = target;
  let shell = false;
  if (rel.endsWith("/") || !(await isFile(path))) {
    // Missing asset → 404 (falls through); anything route-like → the app shell. Nothing in the hashed folders
    // is a route, and the shell must never be served under their year-long immutable cache header.
    if (inHashedDir || (extname(rel) && !rel.endsWith(".html"))) return null;
    path = join(root, "index.html");
    if (!(await isFile(path))) return null;
    shell = true;
  }

  const ext = extname(path);
  const served = shell ? "/index.html" : rel;
  const res = await serveFile(req, {
    path,
    contentType: TYPES[ext] ?? (Bun.file(path).type || "application/octet-stream"),
    cacheControl: inHashedDir && !shell ? IMMUTABLE : REVALIDATE,
    // Keyed on the file actually served (one tag for every route that gets the shell). Hashed so a path with
    // Cyrillic, quotes or control characters can't produce an invalid header.
    etagKey: `web-${Bun.hash(served).toString(36)}`,
  });
  if (!res) return null;
  for (const [k, v] of Object.entries(ISOLATION)) res.headers.set(k, v);
  return res;
}
