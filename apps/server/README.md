# blednify-server

Self-hosted music library for the Blednify app. Bun + Hono + SQLite (WAL, FTS5). It indexes a folder of audio
files and serves the JSON API and audio streams described in [`docs/API.md`](../../docs/API.md).

## Run

```sh
cd apps/server
bun install
MUSIC_DIR=~/Music LISTEN_TOKEN=<secret> ADMIN_TOKEN=<other-secret> bun start   # http://0.0.0.0:8787
MUSIC_DIR=~/Music ALLOW_OPEN_READS=1 bun start          # trusted LAN / local dev: no listen token
bun run dev                                            # same, with --watch
bun run scan                                           # one-off index of MUSIC_DIR, prints {added,removed,total}
bun run typecheck && bun test
```

The server answers immediately on startup and indexes `MUSIC_DIR` in the background. Later scans are
incremental: files whose size and mtime are unchanged are skipped and rows for deleted files are removed.
Trigger one with `POST /api/rescan` or `bun run scan` (safe while the server is running).

Scans never wipe the library because a volume is missing. An unreadable `MUSIC_DIR` fails the scan, tracks under
an unreadable subfolder are kept, and a background scan that finds no files at all while tracks are indexed
removes nothing (it logs a warning). Only an explicit `POST /api/rescan` reconciles an intentionally emptied folder.

Supported files: `mp3 flac m4a aac ogg opus wav` (case-insensitive). Dot-files and dot-directories are skipped,
symlinks are followed. A file that fails to parse is logged and skipped until its size or mtime changes.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `MUSIC_DIR` | `./music` | Library root (scanned recursively). Uploads go to `MUSIC_DIR/uploads/`. |
| `DATA_DIR` | `./data` | `blednify.db` (SQLite index) and `art/` (artwork cache). Safe to delete; it is rebuilt by a scan. |
| `ADMIN_TOKEN` | unset | When set, `POST /api/tracks`, `DELETE /api/tracks/:id`, `POST /api/rescan` and `POST /api/admin/check` need `Authorization: Bearer <token>`. When unset, those writes return `403`. The app's **Admin mode** (Settings) uses it to upload music. |
| `LISTEN_TOKEN` | unset | Every read (except `/api/health`) needs `Authorization: Bearer <token>`. Writes use `ADMIN_TOKEN` instead. Unset: the server refuses to start unless `ALLOW_OPEN_READS=1`. |
| `ALLOW_OPEN_READS` | unset | `1` serves the library without a listen token. Only for a trusted LAN. |
| `ALLOW_OPEN_WRITES` | unset | `1` allows writes without a token when `ADMIN_TOKEN` is unset. Only for a trusted LAN. |
| `MAX_UPLOAD_MB` | `95` | Max size of one upload request. Larger requests get `413 {"error": ...}`. |
| `LYRICS_ONLINE` | `1` | `0` stops looking up missing lyrics on [lrclib.net](https://lrclib.net). Lookups send only artist, title, album and duration, and are cached (hits 180 days, misses 7 days). |
| `IMPORTS` | `1` | `0` turns playlist imports off. They need `yt-dlp`, `ffmpeg` and `ffprobe` on `PATH` (the Docker image ships them, plus `deno` for YouTube). |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | unset | Optional Spotify developer app (client credentials). Without it, Spotify imports read the public playlist page: at most 100 songs, album names come from YouTube Music. |
| `IMPORT_CONCURRENCY` | `2` | Songs downloaded in parallel per import (max 6). |
| `YTDLP_PATH` / `FFMPEG_PATH` / `FFPROBE_PATH` | on `PATH` | Tool locations. |
| `YTDLP_PIP` | unset (image: `/opt/ytdlp/bin/pip`) | When set, yt-dlp is upgraded at start and daily, since YouTube breaks old releases. |
| `LRCLIB_URL` | `https://lrclib.net` | Base URL of an LRCLIB-compatible API (for a self-hosted mirror). |
| `WEB_DIR` | unset | Folder with the built web app (`tools/web/deploy.sh <dir>`), served at `/` with cross-origin isolation headers. Unset: nothing is served outside `/api`. |
| `LOG_REQUESTS` | `1` | `0` turns off the one-line-per-request log. Successful `/api/health` calls are never logged. |

## Playlist imports

Paste a Spotify, SoundCloud or YouTube playlist link in the app (Library → Import playlist, Admin mode). The server
resolves the list, downloads each song into `MUSIC_DIR/imports/` with the original's title, artists, album, year,
track number and cover, and the app builds a playlist with the same name and cover. Spotify has no downloadable
audio, so each song is matched on YouTube Music by title, artists and duration; a song that cannot be matched is
listed as failed and can be retried. SoundCloud Go+ songs (30-second previews for everyone else) are matched the same
way. Imports are for music you are entitled to keep; downloading from these services may break their terms.

## Behaviour notes

- **IDs** follow `docs/API.md`: the track id is `sha1(path relative to MUSIC_DIR, "/"-separated)` (first 16 hex
  characters), and the artist id is `sha1(artist)`. For the album id, the `artist` in
  `sha1(artist + "\0" + album)` is the **album artist**: the `albumartist` tag, or the track artist when that
  tag is missing. This keeps compilations ("Various Artists") together as one album. Artists are the union of
  track artists and album artists. `/api/artists/:id` lists every album the artist appears on and every track
  where they are the track artist or the album artist.
- **Fallbacks**: if there is no title tag, the title comes from the filename. `01 - Artist - Title.mp3` gives
  track 1, artist `Artist` and title `Title`. Otherwise the fallbacks are `Unknown Artist` and `Unknown Album`.
- **Search** uses SQLite FTS5 (`unicode61 remove_diacritics 2`). Every word is a prefix match, all words must
  match, and results are ordered by relevance. For example, `beyonce hal` finds "Beyoncé – Halo". If FTS5 is
  unavailable, search falls back to `LIKE`, which is not diacritics-insensitive. `/api/tracks?q=` uses relevance
  order unless `sort` is given.
- **Streaming** covers `Range` (single range, `206`), unsatisfiable ranges (`416` with `Content-Range: bytes */size`),
  `If-Range`, `If-None-Match` (`304`) and `HEAD`. Responses are sent zero-copy via `Bun.file` and are never
  compressed. Cache policy is `public, max-age=31536000, immutable`, as the contract requires.
- **Artwork**: the embedded cover is extracted on first request and cached as `DATA_DIR/art/<id>.jpg|png`.
  Later requests are a plain file send. `?size=N` is supported: it is rounded up to 64/128/256/512/1024, resized
  with the built-in `Bun.Image` (aspect kept, no upscaling), encoded as JPEG and cached as `<id>-<bucket>.jpg`.
  Sizes above 1024, or covers already smaller than the bucket, return the original. If resizing fails, the
  original is served. Covers that are neither JPEG nor PNG are converted to JPEG. Cache policy is
  `public, max-age=2592000` plus an ETag.
- **Uploads**: multipart field `file`, repeatable. Filenames are sanitized (no path parts or control/reserved
  characters, at most 200 UTF-8 bytes) and made unique with a ` (n)` suffix. A name whose track id was used
  before (a deleted track) is never reused, since clients cache streams and downloads by id. Files are written
  under hidden temp names and moved into place only after every file in the request parsed; an unreadable or
  corrupt file returns `422`, and nothing from that request is kept. Unsupported extensions return `415`.
  Storage failures return `507` (disk full) or `500` with the errno (for example a read-only or wrongly owned
  `MUSIC_DIR`). Success returns `201 {"items": Track[]}`, already indexed.
- **Lyrics** (`GET /api/tracks/:id/lyrics`) come from, in order: a sidecar file with the same name as the song
  (`Song.lrc`, then `Song.txt`), the embedded lyrics tag (ID3 `USLT`/`SYLT`, Vorbis `LYRICS`, MP4 `©lyr`), then
  LRCLIB. LRC time tags (`[mm:ss.xx]`, several per line, `[offset:]`) give synced lines; anything else is plain
  text. A song without lyrics returns `200` with `synced` and `plain` both `null`.
- **Errors** are always JSON: `{ "error": "..." }`. JSON responses are gzip/deflate-compressed when the client
  accepts it. CORS allows all origins.

## Docker

```sh
cd apps/server
docker build -t blednify-server .
docker run -d --name blednify -p 8787:8787 \
  -e ADMIN_TOKEN=change-me \
  -v /path/to/music:/music -v blednify-data:/data \
  blednify-server
```

Or use `docker compose up -d` with the bundled [`docker-compose.yml`](./docker-compose.yml). CI publishes
`ghcr.io/<owner>/blednify-server:latest` from `main`. The image runs as the non-root `bun` user (uid 1000). It
declares `VOLUME /music /data` and exposes port 8787. Its `HEALTHCHECK` polls `/api/health`. For uploads and
deletes to work, the music volume must be writable by uid 1000.

## Point the app at it

- **On the phone**: Settings → Server → enter `http://<server-ip>:8787` → Test. It should report the track count.
- **At build time**: set `EXPO_PUBLIC_API_URL=http://<server-ip>:8787` (CI uses the `BLEDNIFY_API_URL` repo
  variable). That becomes the default server URL.
- The phone must reach the server. Use the server's LAN IP, not `localhost`. On the Android emulator, use
  `http://10.0.2.2:8787`.
- Plain `http://` to a LAN address needs cleartext traffic allowed in the app build. For use outside your LAN,
  put the server behind HTTPS (for example Caddy or Tailscale) and set `ADMIN_TOKEN`.
