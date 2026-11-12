import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { albumId, artistId, hash16, trackId } from "../src/ids";
import type { Album, Artist, Page, Track } from "../src/library";
import { sanitizeFileName } from "../src/app";
import { png, testServer, wav, type TestServer } from "./fixtures";

type AlbumDetail = Album & { tracks: Track[] };
type ArtistDetail = Artist & { albums: Album[]; tracks: Track[] };

const COVER = png(600);
const FILES = {
  "Beyoncé/I Am/01 Halo.wav": wav({ title: "Halo", artist: "Beyoncé", album: "I Am", track: 1, year: 2008, genre: "Pop", picture: COVER }),
  "Beyoncé/I Am/02 If I Were a Boy.wav": wav({ title: "If I Were a Boy", artist: "Beyoncé", album: "I Am", track: 2, year: 2008 }),
  "Beyoncé/I Am/d2-01 Sweet Dreams.wav": wav({ title: "Sweet Dreams", artist: "Beyoncé", album: "I Am", track: 1, disc: 2 }),
  "Mix/01.wav": wav({ title: "Comp One", artist: "Alpha", album: "Hits", albumArtist: "Various Artists", track: 1 }),
  "Mix/02.wav": wav({ title: "Comp Two", artist: "Beta", album: "Hits", albumArtist: "Various Artists", track: 2 }),
  "loose/Zed - Untagged Song.wav": wav(),
  "loose/.hidden.wav": wav({ title: "Hidden" }),
  "loose/notes.txt": Buffer.from("not audio"),
  "loose/broken.mp3": Buffer.from("definitely not an mp3 file"),
};

let srv: TestServer;
const get = (path: string, init?: RequestInit) => srv.app.request(path, init);
const json = async <T>(path: string): Promise<T> => {
  const res = await get(path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};
const idOf = (rel: string) => trackId(rel);
const HALO = idOf("Beyoncé/I Am/01 Halo.wav");

beforeAll(async () => {
  srv = testServer(FILES);
  expect(await srv.ctx.scanner.scan()).toEqual({ added: 6, removed: 0, total: 6 });
});
afterAll(() => srv.close());

describe("scan", () => {
  test("indexes tags, ids and fallbacks", async () => {
    const t = await json<Track>(`/api/tracks/${HALO}`);
    expect(t).toEqual({
      id: hash16("Beyoncé/I Am/01 Halo.wav"),
      title: "Halo",
      artist: "Beyoncé",
      album: "I Am",
      albumId: albumId("Beyoncé", "I Am"),
      artistId: artistId("Beyoncé"),
      durationMs: 250,
      trackNumber: 1,
      discNumber: null,
      year: 2008,
      genre: "Pop",
      mimeType: "audio/wav",
      sizeBytes: FILES["Beyoncé/I Am/01 Halo.wav"].length,
      bitrate: 128,
      hasArtwork: true,
      addedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      codec: "PCM",
      sampleRate: 8000,
      bitDepth: 16,
      lossless: true,
      edited: false,
    });
    const loose = await json<Track>(`/api/tracks/${idOf("loose/Zed - Untagged Song.wav")}`);
    expect(loose).toMatchObject({ title: "Untagged Song", artist: "Zed", album: "Unknown Album", hasArtwork: false });
  });

  test("untagged files take artist/album from Artist/Album folders", async () => {
    const abs = srv.write("Folder Artist/Folder Album/CD1/03 - Plain.wav", wav({}, 300));
    await srv.ctx.scanner.scan();
    const t = await json<Track>(`/api/tracks/${idOf("Folder Artist/Folder Album/CD1/03 - Plain.wav")}`);
    expect(t).toMatchObject({ title: "Plain", artist: "Folder Artist", album: "Folder Album", trackNumber: 3 });
    rmSync(join(abs, "../../.."), { recursive: true }); // "Folder Artist/"
    await srv.ctx.scanner.scan();
  });

  test("is incremental, picks up changes and removals", async () => {
    expect(await srv.ctx.scanner.scan()).toEqual({ added: 0, removed: 0, total: 6 });

    const abs = srv.write("Mix/02.wav", wav({ title: "Comp Two (Edit)", artist: "Beta", album: "Hits", albumArtist: "Various Artists", track: 2 }, 500));
    utimesSync(abs, new Date(), new Date(Date.now() + 5000));
    srv.write("new/fresh.wav", wav({ title: "Fresh", artist: "Gamma", album: "New" }));
    expect(await srv.ctx.scanner.scan()).toEqual({ added: 1, removed: 0, total: 7 });
    expect((await json<Track>(`/api/tracks/${idOf("Mix/02.wav")}`)).title).toBe("Comp Two (Edit)");

    rmSync(join(srv.musicDir, "new/fresh.wav"));
    expect(await srv.ctx.scanner.scan()).toEqual({ added: 0, removed: 1, total: 6 });
    expect((await get(`/api/tracks/${idOf("new/fresh.wav")}`)).status).toBe(404);
  });

  test("an empty or unreadable music folder never wipes the library", async () => {
    const s = testServer({ "a/one.wav": wav({ title: "One" }), "b/two.wav": wav({ title: "Two" }) });
    try {
      expect((await s.ctx.scanner.scan()).total).toBe(2);
      // Unmounted volume: the mount point is empty.
      for (const d of ["a", "b"]) rmSync(join(s.musicDir, d), { recursive: true });
      expect(await s.ctx.scanner.scan()).toEqual({ added: 0, removed: 0, total: 2 });
      // Root not readable at all: the scan fails instead of deleting.
      rmSync(s.musicDir, { recursive: true });
      await expect(s.ctx.scanner.scan()).rejects.toThrow(/not readable/);
      expect(s.ctx.lib.trackCount()).toBe(2);
      // An explicit rescan does reconcile an intentionally emptied folder.
      mkdirSync(s.musicDir);
      expect(await s.ctx.scanner.scan(true)).toEqual({ added: 0, removed: 2, total: 0 });
    } finally {
      s.close();
    }
  });

  test.skipIf(process.getuid?.() === 0)("keeps tracks under an unreadable subfolder", async () => {
    const s = testServer({ "keep/one.wav": wav({ title: "One" }), "other/two.wav": wav({ title: "Two" }) });
    const dir = join(s.musicDir, "keep");
    try {
      expect((await s.ctx.scanner.scan()).total).toBe(2);
      chmodSync(dir, 0o000);
      expect(await s.ctx.scanner.scan()).toEqual({ added: 0, removed: 0, total: 2 });
    } finally {
      chmodSync(dir, 0o755);
      s.close();
    }
  });

  test("concurrent scans coalesce", async () => {
    const [a, b, c] = await Promise.all([srv.ctx.scanner.scan(), srv.ctx.scanner.scan(), srv.ctx.scanner.scan()]);
    expect(a.total).toBe(6);
    expect(b).toBe(c); // queued callers share one follow-up scan
  });
});

describe("tracks list", () => {
  test("paginates with stable totals", async () => {
    const p1 = await json<Page<Track>>("/api/tracks?limit=4&offset=0&sort=title");
    const p2 = await json<Page<Track>>("/api/tracks?limit=4&offset=4&sort=title");
    expect(p1).toMatchObject({ total: 6, limit: 4, offset: 0 });
    expect(p1.items).toHaveLength(4);
    expect(p2.items).toHaveLength(2);
    const titles = [...p1.items, ...p2.items].map((t) => t.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(new Set(titles).size).toBe(6);
  });

  test("defaults, clamps and validates params", async () => {
    expect(await json<Page<Track>>("/api/tracks")).toMatchObject({ limit: 50, offset: 0, total: 6 });
    expect((await json<Page<Track>>("/api/tracks?limit=9999")).limit).toBe(500);
    expect((await json<Page<Track>>("/api/tracks?q=&limit=")).total).toBe(6);
    for (const bad of ["limit=abc", "limit=0", "offset=-1", "sort=random"]) {
      const res = await get(`/api/tracks?${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
  });

  test("sort=artist groups by artist then disc/track", async () => {
    const { items } = await json<Page<Track>>("/api/tracks?sort=artist&limit=3");
    expect(items.map((t) => t.title)).toEqual(["Comp One", "Comp Two (Edit)", "Halo"]); // Alpha, Beta, Beyoncé
  });

  test("q filters with prefix matching", async () => {
    const page = await json<Page<Track>>("/api/tracks?q=swe dre");
    expect(page.total).toBe(1);
    expect(page.items[0]!.title).toBe("Sweet Dreams");
  });
});

describe("search", () => {
  test("prefix + diacritics-insensitive across tracks, albums, artists", async () => {
    const r = await json<{ tracks: Track[]; albums: Album[]; artists: Artist[] }>("/api/search?q=beyonce");
    expect(r.tracks.map((t) => t.title).sort()).toEqual(["Halo", "If I Were a Boy", "Sweet Dreams"]);
    expect(r.albums.map((a) => a.title)).toEqual(["I Am"]);
    expect(r.artists.map((a) => a.name)).toEqual(["Beyoncé"]);
    expect((await json<{ tracks: Track[] }>("/api/search?q=BEYONCÉ%20hal")).tracks.map((t) => t.title)).toEqual(["Halo"]);
  });

  test("limit and empty/garbage queries", async () => {
    expect((await json<{ tracks: Track[] }>("/api/search?q=beyonce&limit=1")).tracks).toHaveLength(1);
    expect(await json("/api/search?q=")).toEqual({ tracks: [], albums: [], artists: [] });
    expect(await json("/api/search?q=%22*()")).toEqual({ tracks: [], albums: [], artists: [] });
    expect(await json("/api/search?q=zzzzqqq")).toEqual({ tracks: [], albums: [], artists: [] });
  });

  test("LIKE fallback when FTS is unavailable", async () => {
    srv.ctx.db.fts = false;
    try {
      expect((await json<Page<Track>>("/api/tracks?q=hal")).items.map((t) => t.title)).toEqual(["Halo"]);
      expect((await json<{ artists: Artist[] }>("/api/search?q=various")).artists.map((a) => a.name)).toEqual(["Various Artists"]);
    } finally {
      srv.ctx.db.fts = true;
    }
  });
});

describe("albums & artists", () => {
  test("album list + detail sorted by disc, track", async () => {
    const page = await json<Page<Album>>("/api/albums?limit=2");
    expect(page.total).toBe(3); // Hits, I Am, Unknown Album
    expect(page.items.map((a) => a.title)).toEqual(["Hits", "I Am"]);
    const id = albumId("Beyoncé", "I Am");
    const album = await json<AlbumDetail>(`/api/albums/${id}`);
    expect(album).toMatchObject({ id, title: "I Am", artist: "Beyoncé", artistId: artistId("Beyoncé"), year: 2008, trackCount: 3, durationMs: 750, artworkTrackId: HALO });
    expect(album.tracks.map((t) => t.title)).toEqual(["Halo", "If I Were a Boy", "Sweet Dreams"]);
  });

  test("compilations group by album artist", async () => {
    const id = albumId("Various Artists", "Hits");
    const album = await json<AlbumDetail>(`/api/albums/${id}`);
    expect(album.tracks.map((t) => t.artist)).toEqual(["Alpha", "Beta"]);
    expect(album.artworkTrackId).toBeNull();
    const va = await json<ArtistDetail>(`/api/artists/${artistId("Various Artists")}`);
    expect(va).toMatchObject({ name: "Various Artists", albumCount: 1, trackCount: 2 });
    const alpha = await json<ArtistDetail>(`/api/artists/${artistId("Alpha")}`);
    expect(alpha.albums.map((a) => a.id)).toEqual([id]);
    expect(alpha.tracks.map((t) => t.title)).toEqual(["Comp One"]);
  });

  test("artist list + detail", async () => {
    const page = await json<Page<Artist>>("/api/artists");
    expect(page.items.map((a) => a.name)).toEqual(["Alpha", "Beta", "Beyoncé", "Various Artists", "Zed"]);
    const b = await json<ArtistDetail>(`/api/artists/${artistId("Beyoncé")}`);
    expect(b).toMatchObject({ albumCount: 1, trackCount: 3, artworkTrackId: HALO });
    expect(b.albums.map((a) => a.title)).toEqual(["I Am"]);
    expect(b.tracks).toHaveLength(3);
    expect((await json<Page<Album>>("/api/albums?q=hit")).items.map((a) => a.title)).toEqual(["Hits"]);
    expect((await json<Page<Artist>>("/api/artists?q=bet")).items.map((a) => a.name)).toEqual(["Beta"]);
  });
});

describe("stream", () => {
  const size = FILES["Beyoncé/I Am/01 Halo.wav"].length;
  const url = `/api/tracks/${HALO}/stream`;

  test("full response headers", async () => {
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toMatch(/^"[^"]+"$/);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(size);
  });

  test("range requests return 206 with exact bodies", async () => {
    const full = new Uint8Array(FILES["Beyoncé/I Am/01 Halo.wav"]);
    const cases: [string, number, number][] = [
      ["bytes=0-99", 0, 99],
      ["bytes=100-", 100, size - 1],
      ["bytes=-50", size - 50, size - 1],
      [`bytes=10-${size + 1000}`, 10, size - 1],
    ];
    for (const [range, start, end] of cases) {
      const res = await get(url, { headers: { Range: range, "Accept-Encoding": "gzip" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes ${start}-${end}/${size}`);
      expect(res.headers.get("content-length")).toBe(String(end - start + 1));
      const body = new Uint8Array(await res.arrayBuffer());
      expect(body.byteLength).toBe(end - start + 1);
      expect(body).toEqual(full.subarray(start, end + 1));
    }
  });

  test("unsatisfiable range → 416, conditional GET → 304, stale If-Range → 200", async () => {
    const bad = await get(url, { headers: { Range: `bytes=${size}-` } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${size}`);
    const etag = (await get(url)).headers.get("etag")!;
    expect((await get(url, { headers: { "If-None-Match": etag } })).status).toBe(304);
    const stale = await get(url, { headers: { Range: "bytes=0-9", "If-Range": '"old"' } });
    expect(stale.status).toBe(200);
  });

  test("HEAD returns headers without body", async () => {
    const res = await get(url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(size));
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("artwork", () => {
  test("serves cached original and resized variants", async () => {
    const res = await get(`/api/tracks/${HALO}/artwork`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(COVER));
    expect(readdirSync(join(srv.dataDir, "art"))).toContain(`${HALO}.png`);

    const small = await get(`/api/tracks/${HALO}/artwork?size=100`);
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/jpeg");
    const meta = await new Bun.Image(new Uint8Array(await small.arrayBuffer())).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(128);
  });

  test("404 when no artwork", async () => {
    const res = await get(`/api/tracks/${idOf("Mix/01.wav")}/artwork`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe("404s and errors", () => {
  test.each([
    "/api/tracks/0123456789abcdef",
    "/api/tracks/not-an-id",
    "/api/tracks/0123456789abcdef/stream",
    "/api/tracks/0123456789abcdef/artwork",
    "/api/albums/0123456789abcdef",
    "/api/artists/0123456789abcdef",
    "/api/nope",
  ])("%s", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  test("missing file on disk → 404 on stream", async () => {
    const s = testServer({ "x.wav": wav({ title: "X" }) });
    try {
      await s.ctx.scanner.scan();
      rmSync(join(s.musicDir, "x.wav"));
      expect((await s.app.request(`/api/tracks/${trackId("x.wav")}/stream`)).status).toBe(404);
    } finally {
      s.close();
    }
  });
});

describe("http", () => {
  test("CORS for all origins", async () => {
    const res = await get("/api/tracks", { headers: { Origin: "http://example.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const pre = await get("/api/tracks", {
      method: "OPTIONS",
      headers: { Origin: "http://x", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" },
    });
    expect(pre.status).toBe(204);
  });

  test("JSON is compressed, audio never", async () => {
    const res = await get("/api/tracks", { headers: { "Accept-Encoding": "gzip" } });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const audio = await get(`/api/tracks/${HALO}/stream`, { headers: { "Accept-Encoding": "gzip" } });
    expect(audio.headers.get("content-encoding")).toBeNull();
  });
});

describe("writes", () => {
  const form = (...files: [string, Buffer][]) => {
    const fd = new FormData();
    for (const [name, data] of files) fd.append("file", new File([new Uint8Array(data)], name));
    return fd;
  };

  test("writes are refused without ADMIN_TOKEN unless explicitly opened", async () => {
    const s = testServer({}, { ALLOW_OPEN_WRITES: "" });
    try {
      const up = await s.app.request("/api/tracks", { method: "POST", body: form(["a.wav", wav({ title: "Up" })]) });
      expect(up.status).toBe(403);
      expect((await s.app.request("/api/rescan", { method: "POST" })).status).toBe(403);
      expect((await s.app.request("/api/tracks/0123456789abcdef", { method: "DELETE" })).status).toBe(403);
      expect((await s.app.request("/api/tracks")).status).toBe(200);
    } finally {
      s.close();
    }
  });

  test("auth required when ADMIN_TOKEN is set", async () => {
    const s = testServer({}, { ADMIN_TOKEN: "s3cret" });
    try {
      const up = (headers: Record<string, string>) =>
        s.app.request("/api/tracks", { method: "POST", body: form(["a.wav", wav({ title: "Up" })]), headers });
      for (const headers of [{}, { Authorization: "Bearer nope" }, { Authorization: "s3cret" }] as Record<string, string>[]) {
        const res = await up(headers);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
      expect((await s.app.request("/api/rescan", { method: "POST" })).status).toBe(401);
      expect((await s.app.request("/api/tracks/0123456789abcdef", { method: "DELETE" })).status).toBe(401);
      expect((await s.app.request("/api/tracks")).status).toBe(200); // reads stay public

      const auth = { Authorization: "Bearer s3cret" };
      const ok = await up(auth);
      expect(ok.status).toBe(201);
      const { items } = (await ok.json()) as { items: Track[] };
      expect(items).toHaveLength(1);
      expect((await s.app.request(`/api/tracks/${items[0]!.id}`, { method: "DELETE", headers: auth })).status).toBe(204);
      const rescan = await s.app.request("/api/rescan", { method: "POST", headers: auth });
      expect(await rescan.json()).toEqual({ added: 0, removed: 0, total: 0 });
    } finally {
      s.close();
    }
  });

  test("upload indexes immediately with sanitized, unique names; delete removes file + row", async () => {
    const s = testServer();
    try {
      const res = await s.app.request("/api/tracks", {
        method: "POST",
        body: form(["../../evil:name?.WAV", wav({ title: "Uploaded One", artist: "Up" })], ["evil:name?.wav", wav({ title: "Uploaded Two", artist: "Up" })]),
      });
      expect(res.status).toBe(201);
      const { items } = (await res.json()) as { items: Track[] };
      expect(items.map((t) => t.title)).toEqual(["Uploaded One", "Uploaded Two"]);
      expect(readdirSync(join(s.musicDir, "uploads")).sort()).toEqual(["evilname (1).wav", "evilname.wav"]);
      expect(items[0]!.id).toBe(trackId("uploads/evilname.wav"));
      expect((await (await s.app.request("/api/search?q=uploaded")).json() as { tracks: Track[] }).tracks).toHaveLength(2);
      expect(((await (await s.app.request(`/api/artists/${artistId("Up")}`)).json()) as Artist).trackCount).toBe(2);

      const del = await s.app.request(`/api/tracks/${items[0]!.id}`, { method: "DELETE" });
      expect(del.status).toBe(204);
      expect(existsSync(join(s.musicDir, "uploads/evilname.wav"))).toBe(false);
      expect((await s.app.request(`/api/tracks/${items[0]!.id}`)).status).toBe(404);
      expect((await s.app.request(`/api/tracks/${items[0]!.id}`, { method: "DELETE" })).status).toBe(404);

      // The app asks which of its cached ids were deleted; live and unknown ids are not reported.
      const unknown = "0123456789abcdef";
      const gone = await s.app.request(`/api/tracks/gone?ids=${items[0]!.id},${items[1]!.id},${unknown},bogus,${items[0]!.id}`);
      expect(gone.status).toBe(200);
      expect(await gone.json()).toEqual({ gone: [items[0]!.id] });
      expect(await (await s.app.request("/api/tracks/gone")).json()).toEqual({ gone: [] });

      // A new upload with the deleted name must not inherit the retired id (clients cache streams by id).
      const again = await s.app.request("/api/tracks", { method: "POST", body: form(["evilname.wav", wav({ title: "Different" })]) });
      expect(again.status).toBe(201);
      const [fresh] = ((await again.json()) as { items: Track[] }).items;
      expect(fresh!.id).not.toBe(items[0]!.id);
      expect(fresh!.id).toBe(trackId("uploads/evilname (2).wav"));
      expect(readdirSync(join(s.musicDir, "uploads")).sort()).toEqual(["evilname (1).wav", "evilname (2).wav"]); // no temp files left
    } finally {
      s.close();
    }
  });

  test("long non-ASCII names are truncated by bytes, not characters", async () => {
    const name = sanitizeFileName(`${"音".repeat(100)}.wav`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(205);
    expect(name.endsWith("音.wav")).toBe(true);
    const s = testServer();
    try {
      const res = await s.app.request("/api/tracks", { method: "POST", body: form([`${"Ж".repeat(200)}.wav`, wav({ title: "Long" })]) });
      expect(res.status).toBe(201);
    } finally {
      s.close();
    }
  });

  test("filesystem failures are not reported as bad audio", async () => {
    const s = testServer();
    try {
      // `uploads` exists as a file, so the server cannot create the folder.
      s.write("uploads", Buffer.from("x"));
      const res = await s.app.request("/api/tracks", { method: "POST", body: form(["a.wav", wav({ title: "A" })]) });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toContain("could not store the upload");
    } finally {
      s.close();
    }
  });

  test("rejects bad uploads", async () => {
    const s = testServer({}, { MAX_UPLOAD_MB: "1" });
    try {
      const post = (body: FormData | string) => s.app.request("/api/tracks", { method: "POST", body });
      expect((await post(form(["x.txt", Buffer.from("hi")]))).status).toBe(415);
      expect((await post(new FormData())).status).toBe(400);
      expect((await post("plain")).status).toBe(415);
      const corrupt = await post(form(["ok.wav", wav({ title: "Fine" })], ["bad.mp3", Buffer.from("garbage bytes here")]));
      expect(corrupt.status).toBe(422);
      expect(readdirSync(join(s.musicDir, "uploads"))).toEqual([]); // all-or-nothing
      expect((await (await s.app.request("/api/health")).json() as { trackCount: number }).trackCount).toBe(0);
      const big = await post(form(["big.wav", wav({}, 70_000)])); // ~1.1 MB
      expect(big.status).toBe(413);
    } finally {
      s.close();
    }
  });
});

test("random bytes are not accepted as audio", async () => {
  const s = testServer();
  try {
    const fd = new FormData();
    fd.append("file", new File([crypto.getRandomValues(new Uint8Array(65536))], "noise.mp3"));
    fd.append("file", new File([crypto.getRandomValues(new Uint8Array(65536))], "noise.aac"));
    expect((await s.app.request("/api/tracks", { method: "POST", body: fd })).status).toBe(422);
  } finally {
    s.close();
  }
});
