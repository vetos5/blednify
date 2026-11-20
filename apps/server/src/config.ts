import { resolve } from "node:path";

import { DEFAULT_TRUSTED_PROXIES, parseTrustedProxies, type TrustedProxies } from "./auth-limit";

export type Config = {
  port: number;
  musicDir: string;
  dataDir: string;
  /** When set, upload/delete/rescan require `Authorization: Bearer <adminToken>`. */
  adminToken: string | null;
  /** Without an admin token, writes are refused (403) unless this is set (`ALLOW_OPEN_WRITES=1`). */
  allowOpenWrites: boolean;
  maxUploadBytes: number;
  /**
   * When set, every read endpoint requires `Authorization: Bearer <listenToken>` (health reports only
   * `authRequired` without it). Use it whenever the server is reachable from outside your LAN.
   */
  listenToken: string | null;
  /** Without a listen token the server refuses to start unless this is set (`ALLOW_OPEN_READS=1`). */
  allowOpenReads: boolean;
  /** Look up missing lyrics on lrclib.net (`LYRICS_ONLINE=0` turns it off). */
  lyricsOnline: boolean;
  lrclibUrl: string;
  /** Playlist imports (Spotify / SoundCloud / YouTube links) via yt-dlp + ffmpeg. */
  imports: {
    enabled: boolean;
    ytdlp: string;
    ffmpeg: string;
    ffprobe: string;
    /** Tracks downloaded in parallel within one import. */
    concurrency: number;
    /** Optional Spotify Web API app credentials: lift the 100-track limit and give album names / covers. */
    spotifyClientId: string | null;
    spotifyClientSecret: string | null;
    /** pip that owns yt-dlp; when set, yt-dlp is upgraded at start and daily (YouTube changes often). */
    ytdlpPip: string | null;
  };
  /** Built web app (`expo export -p web` output) served at `/`; null when WEB_DIR is unset. */
  webDir: string | null;
  logRequests: boolean;
  /** Peers whose CF-Connecting-IP / X-Forwarded-For name the client for the token-guess limit (auth-limit.ts). */
  trustedProxies: TrustedProxies;
};

function int(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: int("PORT", env.PORT, 8787),
    musicDir: resolve(env.MUSIC_DIR || "./music"),
    dataDir: resolve(env.DATA_DIR || "./data"),
    adminToken: env.ADMIN_TOKEN?.trim() || null,
    listenToken: env.LISTEN_TOKEN?.trim() || null,
    allowOpenWrites: /^(1|true|yes)$/i.test(env.ALLOW_OPEN_WRITES ?? ""),
    allowOpenReads: /^(1|true|yes)$/i.test(env.ALLOW_OPEN_READS ?? ""),
    maxUploadBytes: int("MAX_UPLOAD_MB", env.MAX_UPLOAD_MB, 95) * 1024 * 1024,
    lyricsOnline: !/^(0|false|no|off)$/i.test(env.LYRICS_ONLINE ?? ""),
    lrclibUrl: (env.LRCLIB_URL || "https://lrclib.net").replace(/\/+$/, ""),
    imports: {
      enabled: !/^(0|false|no|off)$/i.test(env.IMPORTS ?? ""),
      ytdlp: env.YTDLP_PATH || "yt-dlp",
      ffmpeg: env.FFMPEG_PATH || "ffmpeg",
      ffprobe: env.FFPROBE_PATH || "ffprobe",
      concurrency: Math.min(int("IMPORT_CONCURRENCY", env.IMPORT_CONCURRENCY, 2), 6),
      spotifyClientId: env.SPOTIFY_CLIENT_ID?.trim() || null,
      spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET?.trim() || null,
      ytdlpPip: env.YTDLP_PIP?.trim() || null,
    },
    webDir: env.WEB_DIR?.trim() ? resolve(env.WEB_DIR.trim()) : null,
    logRequests: env.NODE_ENV !== "test" && env.LOG_REQUESTS !== "0",
    trustedProxies: parseTrustedProxies(env.TRUSTED_PROXIES?.trim() || DEFAULT_TRUSTED_PROXIES),
  };
}
