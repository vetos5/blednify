/**
 * Artist identity: which spellings are the same artist, how a credit ("A, B feat. C") splits into artists, and
 * which artists look like cross-script duplicates (Пошлая Молли / Poshlaya Molly) worth suggesting for a merge.
 */

/**
 * Matching key of an artist name: case, accents, punctuation and spacing are ignored, ё = е (й stays й).
 * Names with the same key are the same artist without any merge.
 */
export function nameKey(name: string): string {
  const s = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/й/g, "\u0001")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\u0001/g, "й");
  const key = s.replace(/[^\p{L}\p{N}]+/gu, "");
  // Names made only of symbols ("†‡†", "...") keep them, so they stay distinct.
  return key || s.replace(/\s+/g, " ").trim();
}

export type CreditPart = { name: string; key: string };

/** Splits on ", " / ";" (when allowed) and on feat. / ft. / featuring (always). "&" and " x " never split. */
const FEAT = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;
const LIST = /\s*[,;]\s*/;

/**
 * The artists of a credit, in order (duplicates dropped). `splitLists` allows splitting on commas; without it
 * only feat./ft. split, so names like "Tyler, The Creator" survive.
 */
export function splitCredit(credit: string, splitLists: boolean): CreditPart[] {
  const featParts = credit.split(FEAT);
  const names = featParts.flatMap((p) => (splitLists ? p.split(LIST) : [p])).map((p) => p.trim()).filter(Boolean);
  const out: CreditPart[] = [];
  const seen = new Set<string>();
  for (const name of names.length ? names : [credit.trim()]) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, key });
  }
  return out;
}

/** True when the credit has comma/semicolon-separated parts (that might be separate artists). */
export const hasListSeparator = (credit: string) => credit.split(FEAT).some((p) => LIST.test(p.trim()));

/** Rebuilds a credit with each artist replaced by its display name, keeping the original separators. */
export function renderCredit(credit: string, splitLists: boolean, display: (part: CreditPart) => string): string {
  const pattern = splitLists ? /(\s+(?:feat\.?|ft\.?|featuring)\s+|\s*[,;]\s*)/i : /(\s+(?:feat\.?|ft\.?|featuring)\s+)/i;
  const pieces = credit.trim().split(new RegExp(pattern.source, "gi"));
  return pieces
    .map((piece, i) => {
      if (i % 2 === 1) return piece; // separator
      const name = piece.trim();
      const key = nameKey(name);
      return name && key ? display({ name, key }) : piece;
    })
    .join("");
}

// ---------- cross-script similarity ----------

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g", ў: "u",
};

/**
 * Latin "sound skeleton" of a name: Cyrillic transliterated, then spelling variants folded (y/i/j, kh/h, w/v,
 * c/k, doubled letters), so "Пошлая Молли" and "Poshlaya Molly" both become "poshlaiamoli".
 */
export function skeleton(name: string): string {
  const base = nameKey(name);
  let s = "";
  for (const ch of base) s += CYR[ch] ?? ch;
  return s
    .replace(/[^a-z0-9]/g, "")
    .replace(/kh/g, "h")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c(?!h)/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/[yj]/g, "i")
    .replace(/(.)\1+/g, "$1");
}

export const hasCyrillic = (s: string) => /\p{Script=Cyrillic}/u.test(s);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 similarity of two skeletons (1 = identical). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) / max > 0.25) return 0;
  return 1 - levenshtein(a, b) / max;
}

export const SUGGEST_MIN = 0.85;
