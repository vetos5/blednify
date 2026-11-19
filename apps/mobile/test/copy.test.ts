// The app says "song" to the user, never "track". This scans source string literals for the word used as
// prose (next to a space), so a stray 'Imported 3 tracks' or 'Next track' fails CI instead of drifting back.
// Identifiers, query keys, SQL and comments are ignored; the allowlist holds deliberate uses.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', 'src');
const LITERAL = /(['"`])([^'"`\n]*?(?:\s[Tt]racks?\b|\b[Tt]racks?\s)[^'"`\n]*?)\1/g;
const CODE = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|json_set)\b|\$\{[^}]*$|^[^$]*\}/;
/** "track 3" in an album row's label is the album track number, which is the right word there. */
const ALLOWED = [/, track \$\{track\.trackNumber/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('user-facing copy', () => {
  test("no string literal calls a song a 'track'", () => {
    const hits: string[] = [];
    for (const file of files(ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const s = line.trim();
          if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
          for (const m of line.matchAll(LITERAL)) {
            const text = m[2];
            if (CODE.test(text) || ALLOWED.some((a) => a.test(line))) continue;
            // A literal that is really the gap between two template expressions (`${a}, track ${b}`) or
            // between two strings on one line ("' ? track.id : '") is code, not copy.
            if (/\btracks?\??\.\w/.test(text)) continue;
            hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${text}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
