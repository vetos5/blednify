import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { HTTPException } from "hono/http-exception";
import { trackId } from "./ids";
import type { Library } from "./library";

/** Max UTF-8 bytes of a sanitized stem: leaves room for ` (999)` + extension under the 255-byte name limit. */
const MAX_STEM_BYTES = 200;

/** Truncates to at most `max` UTF-8 bytes without splitting a code point. */
function truncateUtf8(s: string, max: number): string {
  if (Buffer.byteLength(s) <= max) return s;
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    bytes += Buffer.byteLength(ch);
    if (bytes > max) break;
    out += ch;
  }
  return out;
}

/** Safe single path segment: no separators/control chars, no leading dots, bounded byte length, lowercase ext. */
export function sanitizeFileName(name: string): string {
  // Some clients send the name percent-encoded (Bun ignores `filename*`); store the readable name.
  let raw = name;
  if (/%[0-9a-f]{2}/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Not valid percent-encoding: keep it as sent.
    }
  }
  const base = raw.split(/[\\/]/).pop() ?? "";
  const ext = extname(base).toLowerCase();
  const cleaned = base
    .slice(0, base.length - ext.length)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "");
  const stem = truncateUtf8(cleaned, MAX_STEM_BYTES).replace(/[.\s]+$/, "");
  return `${stem || `upload-${Date.now()}`}${ext}`;
}

/**
 * Hands out new file paths under MUSIC_DIR/<subdir>: `name`, `name (1)`, ... that are free on disk, not claimed by
 * a concurrent writer and whose track id was never used before (ids must never point at different audio).
 */
export class PathClaimer {
  private readonly claimed = new Set<string>();

  constructor(
    private readonly musicDir: string,
    private readonly lib: Library,
  ) {}

  claim(subdir: string, name: string): string {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 0; i <= 999; i++) {
      const file = i === 0 ? name : `${stem} (${i})${ext}`;
      const path = join(this.musicDir, subdir, file);
      if (this.claimed.has(path) || existsSync(path) || this.lib.isIdTaken(trackId(`${subdir}/${file}`))) continue;
      this.claimed.add(path);
      return path;
    }
    throw new HTTPException(409, { message: `too many files named ${name}` });
  }

  release(path: string): void {
    this.claimed.delete(path);
  }
}
