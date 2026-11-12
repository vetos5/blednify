import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { nameKey, renderCredit, similarity, skeleton, splitCredit } from "../src/artists";
import { albumId, artistId, trackId } from "../src/ids";
import { cleanTitle, titleForArtist } from "../src/imports/sources";
import type { Album, Artist, MergeSuggestion, Track } from "../src/library";
import { testServer, wav, type TestServer } from "./fixtures";

type ArtistDetail = Artist & { albums: Album[]; tracks: Track[] };

describe("names", () => {
  test("nameKey ignores case, accents, punctuation, spacing and ё", () => {
    expect(nameKey("ПОШЛАЯ МОЛЛИ")).toBe(nameKey("Пошлая  Молли"));
    expect(nameKey("t.A.T.u.")).toBe(nameKey("TATU"));
    expect(nameKey("Tiësto")).toBe(nameKey("tiesto"));
    expect(nameKey("Ёлка")).toBe(nameKey("Елка"));
    expect(nameKey("Мой")).not.toBe(nameKey("Мои"));
    expect(nameKey("Poshlaya Molly")).not.toBe(nameKey("Пошлая Молли"));
  });

  test("skeletons match across scripts", () => {
    expect(skeleton("Пошлая Молли")).toBe(skeleton("Poshlaya Molly"));
    expect(skeleton("Монеточка")).toBe(skeleton("Monetochka"));
    expect(skeleton("Лобода")).toBe(skeleton("LOBODA"));
    expect(similarity(skeleton("Сплин"), skeleton("Muse"))).toBeLessThan(0.5);
  });

  test("splitCredit / renderCredit", () => {
    expect(splitCredit("A, B feat. C", true).map((p) => p.name)).toEqual(["A", "B", "C"]);
    expect(splitCredit("Tyler, The Creator", false).map((p) => p.name)).toEqual(["Tyler, The Creator"]);
    expect(splitCredit("Simon & Garfunkel", true).map((p) => p.name)).toEqual(["Simon & Garfunkel"]);
    expect(renderCredit("пошлая молли, KATERINA ft. X", true, (p) => (p.name === "пошлая молли" ? "Poshlaya Molly" : p.name))).toBe(
      "Poshlaya Molly, KATERINA ft. X",
    );
  });

  test("title cleanup", () => {
    expect(cleanTitle("Школьник (unreleased)")).toBe("Школьник");
    expect(cleanTitle("Song [Snippet] (prod. Someone)")).toBe("Song");
    expect(cleanTitle("Song prod. by Someone")).toBe("Song");
    expect(cleanTitle("Song #unreleased #molly")).toBe("Song");
    expect(cleanTitle("(unreleased)")).toBe("(unreleased)");
    expect(titleForArtist("ПОШЛАЯ МОЛЛИ - Школьник (unreleased 2018)", "Poshlaya Molly")).toBe("Школьник");
    expect(titleForArtist("Пошлая Молли feat. X - Song", "Poshlaya Molly")).toBe("Song");
    // A prefix that is not the artist is part of the title.
    expect(titleForArtist("Intro - Live", "Poshlaya Molly")).toBe("Intro - Live");
  });
});

describe("artists in the library", () => {
  let srv: TestServer;
  const req = (path: string, init?: RequestInit) => srv.app.request(path, init);
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await req(path, init);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };
  const post = (path: string, body?: unknown, method = "POST") =>
    req(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const names = async () => (await json<{ items: Artist[] }>("/api/artists?limit=500")).items.map((a) => `${a.name}:${a.trackCount}`);

  const FILES = {
    "u/1.wav": wav({ title: "Школьник", artist: "Пошлая Молли", album: "Школьник" }),
    "u/2.wav": wav({ title: "Адская колыбельная", artist: "ПОШЛАЯ МОЛЛИ", album: "АК" }),
    "u/3.wav": wav({ title: "Молли", artist: "Poshlaya Molly", album: "8 способов" }),
    "u/4.wav": wav({ title: "Feature", artist: "Poshlaya Molly, KATERINA", album: "Single" }),
    "u/5.wav": wav({ title: "Yonkers", artist: "Tyler, The Creator", album: "Goblin" }),
    "u/6.wav": wav({ title: "Hit", artist: "Muse feat. Someone", album: "Hits" }),
  };

  beforeAll(async () => {
    srv = testServer(FILES);
    await srv.ctx.scanner.scan();
  });
  afterAll(() => srv.close());

  test("same-script spellings are one artist; credits split into artists", async () => {
    expect(await names()).toEqual([
      "KATERINA:1",
      "Muse:1",
      "Poshlaya Molly:2",
      "Someone:1",
      "Tyler, The Creator:1",
      // the most used spelling is shown (on a tie, the first alphabetically: lowercase before caps)
      "Пошлая Молли:2",
    ]);
    const molly = await json<ArtistDetail>(`/api/artists/${artistId("Poshlaya Molly")}`);
    expect(molly.tracks.map((t) => t.title).sort()).toEqual(["Feature", "Молли"]);
    // the feature track keeps its credit text and links to its first artist
    const feature = await json<Track>(`/api/tracks/${trackId("u/4.wav")}`);
    expect(feature).toMatchObject({ artist: "Poshlaya Molly, KATERINA", artistId: artistId("Poshlaya Molly") });
    // an id from before (the whole credit) still opens the main artist
    expect((await json<Artist>(`/api/artists/${artistId("Poshlaya Molly, KATERINA")}`)).name).toBe("Poshlaya Molly");
  });

  test("suggestions, merge, rename, unmerge", async () => {
    const { items } = await json<{ items: MergeSuggestion[] }>("/api/admin/artists/suggestions", { method: "POST" });
    expect(items.map((s) => [s.a.name, s.b.name].sort())).toEqual([["Poshlaya Molly", "Пошлая Молли"]]);

    const cyr = artistId("ПОШЛАЯ МОЛЛИ");
    // a name that is a third artist is refused instead of swallowing it
    expect((await post("/api/admin/artists/merge", { ids: [artistId("Poshlaya Molly"), cyr], name: "Muse" })).status).toBe(409);
    const merged = await json<ArtistDetail>("/api/admin/artists/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [artistId("Poshlaya Molly"), cyr], name: "Poshlaya Molly" }),
    });
    expect(merged).toMatchObject({ id: artistId("Poshlaya Molly"), name: "Poshlaya Molly", merged: true, trackCount: 4 });
    expect(merged.aliases.sort()).toEqual(["ПОШЛАЯ МОЛЛИ", "Пошлая Молли"]);
    expect((await json<Track>(`/api/tracks/${trackId("u/1.wav")}`)).artist).toBe("Poshlaya Molly");
    // the old id and the album id from the file tags still resolve
    expect((await json<Artist>(`/api/artists/${cyr}`)).name).toBe("Poshlaya Molly");
    expect((await json<Album>(`/api/albums/${albumId("Пошлая Молли", "Школьник")}`)).artist).toBe("Poshlaya Molly");
    expect((await json<{ items: MergeSuggestion[] }>("/api/admin/artists/suggestions", { method: "POST" })).items).toEqual([]);
    // the other spelling is searchable
    expect((await json<{ artists: Artist[] }>("/api/search?q=пошлая")).artists.map((a) => a.name)).toEqual(["Poshlaya Molly"]);

    // a rescan keeps the merge
    await srv.ctx.scanner.scan(true);
    expect(await names()).toContain("Poshlaya Molly:4");

    expect((await post(`/api/admin/artists/${artistId("Poshlaya Molly")}/rename`, { name: "Muse" })).status).toBe(409);
    const renamed = await json<Artist>(`/api/admin/artists/${artistId("Poshlaya Molly")}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Пошлая Молли" }),
    });
    expect(renamed).toMatchObject({ name: "Пошлая Молли", trackCount: 4 });
    expect((await json<Artist>(`/api/artists/${artistId("Poshlaya Molly")}`)).name).toBe("Пошлая Молли");

    const un = await json<Artist>(`/api/admin/artists/${renamed.id}/unmerge`, { method: "POST" });
    expect(un.merged).toBe(false);
    expect((await names()).filter((n) => /molly|молли/i.test(n)).sort()).toEqual(["Poshlaya Molly:2", "Пошлая Молли:2"]);
  });

  test("dismissed suggestions stay hidden", async () => {
    const res = await post("/api/admin/artists/suggestions/dismiss", { ids: [artistId("Poshlaya Molly"), artistId("ПОШЛАЯ МОЛЛИ")] });
    expect(res.status).toBe(204);
    expect((await json<{ items: MergeSuggestion[] }>("/api/admin/artists/suggestions", { method: "POST" })).items).toEqual([]);
  });

  test("edit track info survives a rescan and can be reset", async () => {
    const id = trackId("u/5.wav");
    const res = await post(`/api/tracks/${id}`, { title: "Yonkers (Edit)", artist: "Tyler, The Creator, Someone" }, "PATCH");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Yonkers (Edit)", artist: "Tyler, The Creator, Someone", edited: true });
    // an admin-typed comma is a list: "Tyler" and "The Creator" are not artists, but nothing else breaks either
    expect(await names()).toContain("Someone:2");
    await srv.ctx.scanner.scan(true);
    expect((await json<Track>(`/api/tracks/${id}`)).title).toBe("Yonkers (Edit)");
    const reset = await post(`/api/tracks/${id}`, { title: null, artist: "" }, "PATCH");
    expect(await reset.json()).toMatchObject({ title: "Yonkers", artist: "Tyler, The Creator", edited: false });
    expect(await names()).toContain("Tyler, The Creator:1");
    expect((await post(`/api/tracks/${"0".repeat(16)}`, { title: "x" }, "PATCH")).status).toBe(404);
    expect((await post(`/api/tracks/${id}`, { title: 5 }, "PATCH")).status).toBe(400);
  });
});

test("lookup returns current info of known ids only", async () => {
  const srv = testServer({ "a.wav": wav({ title: "A", artist: "X" }) });
  await srv.ctx.scanner.scan();
  const res = await srv.app.request(`/api/tracks/lookup?ids=${trackId("a.wav")},${"0".repeat(16)},bad`);
  expect(((await res.json()) as { items: Track[] }).items.map((t) => t.title)).toEqual(["A"]);
  srv.close();
});
