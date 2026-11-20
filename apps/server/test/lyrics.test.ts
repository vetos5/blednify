import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { trackId } from "../src/ids";
import { LyricsService, parseLrc, type Lyrics } from "../src/lyrics";
import { testServer, wav, type TestServer } from "./fixtures";

describe("parseLrc", () => {
  test("parses tags, multi-time lines, offset and word timing", () => {
    const lrc = "[ar:Someone]\n[offset:500]\n[00:01.50]Hello\n[00:05.00][00:10.00]Again <00:05.50>and again\n[01:02.3]Last";
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 1000, text: "Hello" },
      { timeMs: 4500, text: "Again and again" },
      { timeMs: 9500, text: "Again and again" },
      { timeMs: 61800, text: "Last" },
    ]);
  });
  test("no timed lines → null", () => {
    expect(parseLrc("just words\nmore words")).toBeNull();
  });
});

const SONG = "Artist/Album/01 - Song.wav";
const EMBEDDED = "Artist/Album/02 - Tagged.wav";
const PLAIN = "Artist/Album/03 - Plain.wav";
const NONE = "Artist/Album/04 - Nothing.wav";

let srv: TestServer;
const lyricsOf = async (rel: string): Promise<Lyrics> => {
  const res = await srv.app.request(`/api/tracks/${trackId(rel)}/lyrics`);
  expect(res.status).toBe(200);
  return (await res.json()) as Lyrics;
};

beforeAll(async () => {
  srv = testServer(
    {
      [SONG]: wav({ title: "Song", artist: "Artist", album: "Album" }),
      "Artist/Album/01 - Song.lrc": Buffer.from("[00:00.10]First line\n[00:00.20]Second line\n"),
      [EMBEDDED]: wav({ title: "Tagged", artist: "Artist", album: "Album", lyrics: "Embedded one\nEmbedded two" }),
      [PLAIN]: wav({ title: "Plain", artist: "Artist", album: "Album" }),
      "Artist/Album/03 - Plain.txt": Buffer.from("Plain words\n"),
      [NONE]: wav({ title: "Nothing", artist: "Artist", album: "Album" }),
    },
    { LYRICS_ONLINE: "0" },
  );
  await srv.ctx.scanner.scan();
});
afterAll(() => srv.close());

describe("GET /api/tracks/:id/lyrics", () => {
  test("sidecar .lrc gives synced lines", async () => {
    expect(await lyricsOf(SONG)).toEqual({
      synced: [
        { timeMs: 100, text: "First line" },
        { timeMs: 200, text: "Second line" },
      ],
      plain: "First line\nSecond line",
      instrumental: false,
      source: "file",
    });
  });
  test("embedded USLT gives plain text", async () => {
    const l = await lyricsOf(EMBEDDED);
    expect(l.source).toBe("embedded");
    expect(l.plain).toBe("Embedded one\nEmbedded two");
    expect(l.synced).toBeNull();
  });
  test("sidecar .txt gives plain text", async () => {
    expect((await lyricsOf(PLAIN)).plain).toBe("Plain words");
  });
  test("nothing found (online off) → empty lyrics, not an error", async () => {
    expect(await lyricsOf(NONE)).toEqual({ synced: null, plain: null, instrumental: false, source: null });
  });
  test("revalidated, not cached for an hour: unchanged → 304, a .lrc added later → the new lyrics", async () => {
    const LATE = "Artist/Album/05 - Late.wav";
    srv.write(LATE, wav({ title: "Late", artist: "Artist", album: "Album" }));
    await srv.ctx.scanner.scan();
    const url = `/api/tracks/${trackId(LATE)}/lyrics`;
    const first = await srv.app.request(url);
    expect(first.headers.get("cache-control")).toBe("public, no-cache");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"ly-/);
    expect(((await first.json()) as Lyrics).source).toBeNull();
    const same = await srv.app.request(url, { headers: { "If-None-Match": etag! } });
    expect(same.status).toBe(304);
    srv.write("Artist/Album/05 - Late.lrc", Buffer.from("[00:00.10]Added later\n"));
    const fresh = await srv.app.request(url, { headers: { "If-None-Match": etag! } });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("etag")).not.toBe(etag);
    expect(((await fresh.json()) as Lyrics).plain).toBe("Added later");
  });
  test("unknown track → 404", async () => {
    expect((await srv.app.request("/api/tracks/0000000000000000/lyrics")).status).toBe(404);
  });
});

describe("LRCLIB lookup", () => {
  test("fetches once, caches hits, falls back to search", async () => {
    const calls: string[] = [];
    const fetchMock = mock(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/api/get")) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      return Response.json([
        { duration: 999, syncedLyrics: "[00:01.00]Wrong song" },
        { duration: 0.25, plainLyrics: "Line A\nLine B", syncedLyrics: "[00:00.05]Line A\n[00:00.15]Line B" },
      ]);
    });
    const svc = new LyricsService(srv.ctx.db, { online: true, lrclibUrl: "https://lrclib.test", fetch: fetchMock as unknown as typeof fetch });
    const row = srv.ctx.lib.trackRow(trackId(NONE))!;
    const abs = `${srv.musicDir}/${row.path}`;
    const first = await svc.get(row, abs);
    expect(first.source).toBe("lrclib");
    expect(first.synced).toEqual([
      { timeMs: 50, text: "Line A" },
      { timeMs: 150, text: "Line B" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("artist_name=Artist");
    expect(calls[0]).toContain("track_name=Nothing");
    expect(await svc.get(row, abs)).toEqual(first);
    expect(calls).toHaveLength(2); // served from cache
  });

  test("a miss is cached too", async () => {
    let n = 0;
    const fetchMock = mock(async (url: string | URL | Request) => {
      n++;
      return String(url).includes("/api/get") ? new Response("", { status: 404 }) : Response.json([]);
    });
    const svc = new LyricsService(srv.ctx.db, { online: true, lrclibUrl: "https://lrclib.test", fetch: fetchMock as unknown as typeof fetch });
    const row = { ...srv.ctx.lib.trackRow(trackId(NONE))!, id: "ffffffffffffffff" };
    expect((await svc.get(row, `${srv.musicDir}/${row.path}`)).source).toBeNull();
    expect((await svc.get(row, `${srv.musicDir}/${row.path}`)).source).toBeNull();
    expect(n).toBe(2);
  });
});

describe("POST /api/admin/check", () => {
  test("needs the admin token and reports the upload limit", async () => {
    const s = testServer({}, { ADMIN_TOKEN: "admin-1", ALLOW_OPEN_WRITES: "0", LISTEN_TOKEN: "listen-1" });
    try {
      expect((await s.app.request("/api/admin/check", { method: "POST" })).status).toBe(401);
      expect((await s.app.request("/api/admin/check", { method: "POST", headers: { Authorization: "Bearer listen-1" } })).status).toBe(401);
      const ok = await s.app.request("/api/admin/check", { method: "POST", headers: { Authorization: "Bearer admin-1" } });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { maxUploadBytes: number }).maxUploadBytes).toBe(95 * 1024 * 1024);
    } finally {
      s.close();
    }
  });
});
