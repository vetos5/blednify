import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AGGREGATE_INTERVAL_MS, SAVE_INTERVAL_MS } from "../src/imports/importer";
import { testServer, wav } from "./fixtures";

type Srv = ReturnType<typeof testServer>;

const dump = (srv: Srv) => {
  const q = (t: string) => srv.ctx.db.sql.query(`SELECT * FROM ${t} ORDER BY 1, 2`).all();
  return JSON.parse(
    JSON.stringify({ albums: q("albums"), artists: q("artists"), artist_albums: q("artist_albums"), track_artists: q("track_artists") }),
  ) as { albums: unknown[] };
};

async function addSong(srv: Srv, n: number, defer: boolean) {
  const tmp = srv.write(
    `.tmp-${n}.wav`,
    wav({ title: `Song ${n}`, artist: n % 2 ? "Ann" : "Ann, Bob", album: n < 3 ? "One" : "Two", track: n }, 100, 300 + n),
  );
  const final = srv.write(`imports/.keep-${n}`, Buffer.alloc(0)).replace(/\.keep-\d+$/, `s${n}.wav`);
  return srv.ctx.scanner.indexUploads([{ tmp, final }], { deferAggregates: defer });
}

describe("deferred aggregate rebuilds", () => {
  const eager = testServer();
  const lazy = testServer();
  afterAll(() => {
    eager.close();
    lazy.close();
  });

  test("flushing once gives the same albums and artists as rebuilding after every song", async () => {
    let rebuilds = 0;
    const real = lazy.ctx.lib.rebuildAggregates.bind(lazy.ctx.lib);
    lazy.ctx.lib.rebuildAggregates = () => {
      rebuilds++;
      real();
    };
    for (let n = 1; n <= 4; n++) {
      await addSong(eager, n, false);
      await addSong(lazy, n, true);
    }
    expect(rebuilds).toBe(0);
    expect(dump(lazy).albums).toHaveLength(0);
    expect(lazy.ctx.lib.flushAggregates()).toBe(true);
    expect(rebuilds).toBe(1);
    expect(lazy.ctx.lib.flushAggregates()).toBe(false); // nothing changed since
    expect(dump(lazy).albums).toHaveLength(2);
    expect(dump(lazy)).toEqual(dump(eager));
  });

  test("a min interval holds the flush back", async () => {
    await addSong(lazy, 5, true);
    expect(lazy.ctx.lib.flushAggregates(AGGREGATE_INTERVAL_MS)).toBe(false);
    expect(lazy.ctx.lib.flushAggregates(0)).toBe(true);
  });
});

describe("import job saves", () => {
  const srv = testServer();
  afterAll(() => srv.close());
  const imp = srv.ctx.importer as unknown as {
    jobs: Map<string, { id: string; done: number }>;
    touch(j: unknown): void;
    save(j: unknown): void;
    flush(): void;
    remove(id: string): Promise<boolean>;
  };
  const sql = srv.ctx.db.sql;
  const doc = (id: string) => JSON.parse(sql.query<{ doc: string }, [string]>("SELECT doc FROM imports WHERE id = ?").get(id)!.doc) as { done: number };
  const mk = (id: string) => {
    const job = { id, url: "u", state: "running", items: [], done: 0, createdAt: new Date().toISOString(), updatedAt: "" };
    imp.jobs.set(id, job);
    return job;
  };

  test("progress saves coalesce, flush writes the latest state", () => {
    const job = mk("a");
    imp.save(job);
    let count = 0;
    const orig = sql.query.bind(sql);
    (sql as unknown as { query: unknown }).query = (q: string) => {
      if (q.startsWith("INSERT INTO imports")) count++;
      return orig(q);
    };
    try {
      for (let i = 1; i <= 50; i++) {
        job.done = i;
        imp.touch(job);
      }
      expect(count).toBe(0);
      expect(doc("a").done).toBe(0);
      imp.flush();
      expect(count).toBe(1);
      expect(doc("a").done).toBe(50);
      imp.flush();
      expect(count).toBe(1);
    } finally {
      (sql as unknown as { query: unknown }).query = orig;
    }
  });

  test("a trailing write lands by itself after the interval", async () => {
    const job = mk("b");
    imp.save(job);
    job.done = 7;
    imp.touch(job);
    expect(doc("b").done).toBe(0);
    await Bun.sleep(SAVE_INTERVAL_MS + 200);
    expect(doc("b").done).toBe(7);
  });

  test("an immediate save supersedes a pending one", () => {
    const job = mk("c");
    imp.save(job);
    job.done = 1;
    imp.touch(job);
    job.done = 2;
    imp.save(job);
    expect(doc("c").done).toBe(2);
  });

  test("a deleted job is not brought back by a pending save", async () => {
    const job = mk("d");
    imp.save(job);
    job.done = 3;
    imp.touch(job);
    await imp.remove("d");
    imp.flush();
    imp.save(job);
    await Bun.sleep(SAVE_INTERVAL_MS + 200);
    expect(sql.query("SELECT 1 FROM imports WHERE id = 'd'").get()).toBeNull();
  });
});
