import { stat } from "node:fs/promises";

export type ServeFileOptions = {
  path: string;
  contentType: string;
  cacheControl: string;
  /** Stable prefix for the ETag; size + mtime are appended so content changes produce a new tag. */
  etagKey: string;
};

const etagMatches = (header: string | null, etag: string) =>
  header != null && header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*");

/** Parses a single `bytes=` range. undefined ⇒ ignore header (serve 200); null ⇒ unsatisfiable (416). */
export function parseRange(header: string, size: number): { start: number; end: number } | null | undefined {
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return undefined; // malformed or multi-range: RFC 9110 allows ignoring it
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return undefined;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0 || size === 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (b !== "" && Number(b) < start) return undefined; // invalid range spec
  if (start >= size) return null;
  return { start, end };
}

/**
 * Serves a file with Range (206/416), conditional GET (304), ETag and Last-Modified.
 * Returns null when the file does not exist. Body is a lazy Bun.file slice (sendfile, no buffering).
 */
export async function serveFile(req: Request, o: ServeFileOptions): Promise<Response | null> {
  let st;
  try {
    st = await stat(o.path);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const size = st.size;
  // ETags may only hold visible ASCII other than `"`; anything else would make the Headers constructor throw.
  const key = o.etagKey.replace(/[^\x21\x23-\x7e]/g, "_");
  const etag = `"${key}-${size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": o.cacheControl,
    "Content-Type": o.contentType,
    ETag: etag,
    "Last-Modified": st.mtime.toUTCString(),
  });

  if (etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });

  const file = Bun.file(o.path);
  const rangeHeader = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  const rangeAllowed = !ifRange || ifRange === etag || ifRange === headers.get("Last-Modified");
  const range = rangeHeader && rangeAllowed ? parseRange(rangeHeader, size) : undefined;

  if (range === null) {
    headers.set("Content-Range", `bytes */${size}`);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ error: "range not satisfiable" }), { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(file.slice(range.start, range.end + 1), { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(file, { status: 200, headers });
}
