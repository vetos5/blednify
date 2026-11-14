import { mkdirSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseFile, selectCover } from "music-metadata";

export type ArtFile = { path: string; mime: "image/jpeg" | "image/png" };

/** Resized variants are cached per bucket so arbitrary ?size values can't blow up the cache. */
const SIZE_BUCKETS = [64, 128, 256, 512, 1024] as const;
const ORIGINAL_EXTS = ["jpg", "png"] as const;

/**
 * Embedded-cover cache: DATA_DIR/art/<trackId>.<jpg|png> (original, extracted lazily on first request)
 * and DATA_DIR/art/<trackId>-<bucket>.jpg (downscaled with Bun.Image).
 */
export class ArtworkCache {
  private readonly inflight = new Map<string, Promise<ArtFile | null>>();
  /** Tracks whose embedded cover couldn't be converted; not retried on every request (cleared on invalidate). */
  private readonly unreadable = new Set<string>();

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Cached (or freshly extracted) artwork for a track file; null if it has no embedded picture. */
  async get(trackId: string, audioPath: string, size: number | null): Promise<ArtFile | null> {
    const original = await this.original(trackId, audioPath);
    if (!original || size === null) return original;
    const bucket = SIZE_BUCKETS.find((b) => b >= size);
    if (!bucket) return original;
    return this.once(`${trackId}-${bucket}`, async () => {
      const path = join(this.dir, `${trackId}-${bucket}.jpg`);
      if (await Bun.file(path).exists()) return { path, mime: "image/jpeg" };
      try {
        const img = new Bun.Image(original.path, { maxPixels: 64_000_000 });
        const meta = await img.metadata();
        // Already small enough: serve the original instead of re-encoding.
        if (meta.width <= bucket && meta.height <= bucket) return original;
        const tmp = `${path}.${process.pid}.tmp`;
        await img.resize(bucket, bucket, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).write(tmp);
        await rename(tmp, path);
        return { path, mime: "image/jpeg" };
      } catch (err) {
        console.warn(`[art] resize failed for ${trackId}: ${(err as Error).message}`);
        return original;
      }
    });
  }

  /** Drop every cached file for a track (it changed or was removed). */
  async invalidate(trackId: string): Promise<void> {
    this.unreadable.delete(trackId);
    const names = [...ORIGINAL_EXTS.map((e) => `${trackId}.${e}`), ...SIZE_BUCKETS.map((b) => `${trackId}-${b}.jpg`)];
    await Promise.all(names.map((n) => rm(join(this.dir, n), { force: true })));
  }

  private original(trackId: string, audioPath: string): Promise<ArtFile | null> {
    if (this.unreadable.has(trackId)) return Promise.resolve(null);
    return this.once(trackId, async () => {
      for (const ext of ORIGINAL_EXTS) {
        const path = join(this.dir, `${trackId}.${ext}`);
        if (await Bun.file(path).exists()) return { path, mime: ext === "png" ? "image/png" : "image/jpeg" };
      }
      const { common } = await parseFile(audioPath, { duration: false });
      const cover = selectCover(common.picture);
      if (!cover || cover.data.byteLength === 0) return null;
      const fmt = cover.format.toLowerCase();
      const isPng = fmt.includes("png");
      const isJpeg = fmt.includes("jpeg") || fmt.includes("jpg");
      const path = join(this.dir, `${trackId}.${isPng ? "png" : "jpg"}`);
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        if (isPng || isJpeg) await Bun.write(tmp, cover.data);
        else await new Bun.Image(cover.data).jpeg({ quality: 90 }).write(tmp); // webp/gif/bmp → jpeg
      } catch (err) {
        // An image format Bun.Image can't decode: treat the track as having no cover instead of a 500 per request.
        console.warn(`[art] unreadable cover for ${trackId} (${cover.format}): ${(err as Error).message}`);
        this.unreadable.add(trackId);
        await rm(tmp, { force: true });
        return null;
      }
      await rename(tmp, path);
      return { path, mime: isPng ? "image/png" : "image/jpeg" };
    });
  }

  private once(key: string, fn: () => Promise<ArtFile | null>): Promise<ArtFile | null> {
    let p = this.inflight.get(key);
    if (!p) {
      p = fn().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }
}
