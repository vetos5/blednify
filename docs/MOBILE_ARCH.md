# Blednify mobile architecture (contract between `core` and `ui`)

Expo SDK 58 · React Native 0.88 (New Architecture, Hermes, React Compiler on) · expo-router · TypeScript strict.
Phones only (Android 16 primary, iOS). No web target. No ads, no tracking, no analytics, no accounts.

## Ownership

| Path | Owner | Notes |
|---|---|---|
| `src/core/**` | core | data, storage, playback, downloads, import, settings. No JSX except `CoreProvider`. |
| `src/app/**`, `src/ui/**`, `assets/**` | ui | routes, screens, components, theme, icons |
| `app.json`, `package.json`, `bun.lock` | core | ui must NOT edit these; list needed changes in its final report |

Everything the UI needs is imported from the barrel `@/core` (`src/core/index.ts`). UI never imports `expo-audio`, `expo-sqlite`, `expo-file-system` directly.

## Unified track model

```ts
// src/core/types.ts
export type Origin = 'remote' | 'local';           // remote = from server, local = user-imported file
export type AppTrack = {
  key: string;            // globally unique: `r:${remoteId}` or `l:${localId}`
  id: string;             // remote track id or local id
  origin: Origin;
  title: string;
  artist: string;
  album: string;
  albumId: string;        // remote: server albumId; local: `l:` + hash(artist+album)
  artistId: string;
  durationMs: number;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  mimeType: string;
  sizeBytes: number;
  artworkUri: string | null;   // http(s) URL or file:// — pass straight to expo-image
  streamUri: string;           // what the player loads: local file if present, else server stream URL
  localUri: string | null;     // file:// when downloaded or imported, else null
  addedAt: string;
};
export type AlbumView = { id: string; origin: Origin; title: string; artist: string; artistId: string; year: number | null; trackCount: number; durationMs: number; artworkUri: string | null };
export type ArtistView = { id: string; origin: Origin; name: string; albumCount: number; trackCount: number; artworkUri: string | null };
export type Playlist = { id: string; name: string; trackCount: number; createdAt: string; updatedAt: string; artworkUris: string[] /* up to 4 for mosaic */ };
export type RepeatMode = 'off' | 'all' | 'one';
export type DownloadStatus = 'none' | 'queued' | 'downloading' | 'done' | 'error';
```

## `@/core` public API (exact names)

### Provider
- `CoreProvider({ children })` — wrap the root layout. Sets up QueryClient, opens SQLite + migrations, configures audio session, mounts the hidden player host. Renders `children` immediately (do not block first paint on DB; hooks handle loading).

### Server catalog (react-query, cached, stale-while-revalidate)
- `useServerStatus(): { online: boolean; trackCount: number; isLoading: boolean; serverUrl: string }`
- `useRemoteTracks(params?: { q?: string; sort?: 'added' | 'title' | 'artist' }): { tracks: AppTrack[]; total: number; isLoading: boolean; isError: boolean; error: unknown; refetch(): void; fetchNextPage(): void; hasNextPage: boolean; isFetchingNextPage: boolean }`
- `useRemoteAlbums(): { albums: AlbumView[]; isLoading: boolean; refetch(): void }`
- `useAlbum(id: string, origin: Origin): { album: AlbumView | null; tracks: AppTrack[]; isLoading: boolean }`
- `useArtist(id: string, origin: Origin): { artist: ArtistView | null; albums: AlbumView[]; tracks: AppTrack[]; isLoading: boolean }`
- `useSearch(q: string): { tracks: AppTrack[]; albums: AlbumView[]; artists: ArtistView[]; isLoading: boolean }` — merges local + remote, local first, deduped by key, debounced internally (~200ms).

### Local library (SQLite-backed, reactive — hooks re-render on change)
- `useLocalTracks(): AppTrack[]` — imported files + downloaded remote tracks, newest first
- `useLocalAlbums(): AlbumView[]`
- `useLikedTracks(): AppTrack[]`, `useIsLiked(key: string): boolean`, `toggleLike(track: AppTrack): Promise<void>`
- `useRecentlyPlayed(limit?: number): AppTrack[]` (recorded automatically by the player after 3 s of playback)
- `usePlaylists(): Playlist[]`, `usePlaylist(id: string): { playlist: Playlist | null; tracks: AppTrack[] }`
- `createPlaylist(name: string): Promise<string /* id */>`, `renamePlaylist(id, name)`, `deletePlaylist(id)`, `addToPlaylist(id, tracks: AppTrack[])`, `removeFromPlaylist(id, index: number)`, `reorderPlaylist(id, from: number, to: number)` — all `Promise<void>`

### Player
- `player` (imperative singleton object):
  `playTracks(tracks: AppTrack[], startIndex?: number, opts?: { shuffle?: boolean }): void`,
  `togglePlay()`, `play()`, `pause()`, `next()`, `previous()` (restart if > 3 s in), `seekTo(ms: number)`,
  `playNext(tracks: AppTrack[])`, `addToQueue(tracks: AppTrack[])`, `removeFromQueue(index: number)`, `moveInQueue(from: number, to: number)`, `jumpTo(index: number)`,
  `setRepeat(mode: RepeatMode)`, `cycleRepeat()`, `toggleShuffle()`
- `usePlayer<T>(selector: (s: PlayerState) => T): T` — zustand selector hook, where
  `PlayerState = { queue: AppTrack[]; index: number; current: AppTrack | null; isPlaying: boolean; isBuffering: boolean; repeat: RepeatMode; shuffle: boolean; error: string | null; errorId: number /* increments per error */ }`
- `useProgress(): { positionMs: number; durationMs: number }` — ~4 Hz, isolated so only progress UI re-renders
- Background playback + lock-screen / notification controls with title, artist, artwork are core's job.
- Queue + position persisted (MMKV) and restored paused on cold start.
- Audio backend: `core/player/audio.ts` (expo-audio) / `audio.web.ts` (web: ONE reused `<audio>` element + Media
  Session, so iOS keeps auto-advancing with the screen locked). The engine only talks to that module.

### Web app (iPhone via Safari → Add to Home Screen)
- Same code base, `expo export -p web`, hosted by the server (`WEB_DIR`). Streams only:
  `fileStorageSupported` (from `@/core`) is false there and the UI hides import, downloads and upload.
- Auth: `web-session.ts` trades the listen token for an HttpOnly cookie (`POST /api/session`) because media
  elements cannot send headers; image sources carry no headers on web.
- Platform files: `*.web.ts` siblings (`audio`, `lock-art`); `paths.ts` returns a never-matching prefix on web.

### Downloads (server → device, offline)
- `downloadTracks(tracks: AppTrack[]): void` (ignores local/already-downloaded), `cancelDownload(key)`, `removeDownload(key): Promise<void>`
- `useDownloadState(key: string): { status: DownloadStatus; progress: number /* 0..1 */ }`
- `useDownloads(): { active: { track: AppTrack; status: DownloadStatus; progress: number }[]; completedCount: number; bytesUsed: number }`
- Downloaded files live in app document storage; once downloaded a remote track's `streamUri`/`localUri` point to the file everywhere.

### Import (user's own files, local; uploaded only on request in admin mode)
- `importFromDevice(): Promise<{ imported: number; skipped: number }>` — system picker, multi-select audio, copies into app storage, reads tags (title/artist/album/duration/embedded artwork) with filename fallback `Artist - Title.ext`.
- `deleteLocalTrack(key: string): Promise<void>`

### Lyrics
- `useLyrics(track: AppTrack | null): { lyrics: Lyrics | null; isLoading: boolean; isError: boolean }` — server tracks via `GET /api/tracks/:id/lyrics`; imported tracks from their embedded tag, then LRCLIB when `lyricsOnline`. Answers are cached in MMKV so downloaded tracks keep lyrics offline.
- `activeLyricIndex(lines, positionMs): number`, `hasLyrics(l): boolean`

### Admin (only shown when `adminMode` is on)
- `checkAdmin(url?, token?)`, `rescanServer()`, `deleteFromServer(track)`
- `pickAndUpload(): Promise<number>` (system picker → upload queue), `uploadLocalTracks(tracks)` (imported tracks → server)
- `useUploads(): { items: UploadItem[]; active: number; maxUploadBytes: number | null }`, `retryUpload(id)`, `cancelUpload(id)`, `clearUploads()`
- Uploads run one at a time over `XMLHttpRequest` (progress), sending only the admin token.

### Settings (MMKV, synchronous)
- `useSettings()`: `serverUrl`, `accessToken`, `downloadOnWifiOnly`, `adminMode`, `adminToken`, `lyricsOnline` and their setters (`saveConnection(url, token)` saves server + access token together)
- `testServer(url: string): Promise<{ ok: boolean; trackCount?: number; error?: string }>`
- Default `serverUrl` = `process.env.EXPO_PUBLIC_API_URL ?? ''`. Empty url ⇒ app works fully offline with local library; remote hooks return empty, `online: false`.

### Utilities
- `formatDuration(ms: number): string` (`3:07`, `1:02:03`), `formatBytes(n: number): string`

## Routes (ui)

```
src/app/_layout.tsx            Root Stack inside CoreProvider + GestureHandlerRootView; dark theme; StatusBar light
src/app/(tabs)/_layout.tsx     Tabs: Home · Search · Library; MiniPlayer docked above tab bar
src/app/(tabs)/index.tsx       Home: greeting, recently played, quick picks, server new additions, albums rail
src/app/(tabs)/search.tsx      Instant search (local + server), genre/browse tiles when empty
src/app/(tabs)/library.tsx     Filters: Playlists · Albums · Liked · Downloaded · On this device; import button
src/app/player.tsx             Full-screen Now Playing (modal, swipe down to dismiss)
src/app/queue.tsx              Queue with drag reorder / swipe remove
src/app/lyrics.tsx             Full-screen synced lyrics (auto-scroll, tap a line to seek); peek card on the player
src/app/upload.tsx             Admin: upload files to the server with per-file progress
src/app/album/[id].tsx         ?origin=remote|local
src/app/artist/[id].tsx        ?origin=remote|local
src/app/playlist/[id].tsx
src/app/downloads.tsx
src/app/settings.tsx           Server URL + tokens, Wi-Fi only downloads, lyrics, admin mode (token, upload, rescan), storage, about
```

## Performance rules (both owners)
- Lists: `@shopify/flash-list` v2 only. Rows are memo-cheap, fixed height, no inline object churn.
- Images: `expo-image` with `cachePolicy="memory-disk"`, `recyclingKey`, small `transition`.
- Animations: Reanimated 4 / worklets on UI thread. No JS-thread animation loops.
- Player progress goes through `useProgress` only; nothing else subscribes to time.
- No blocking work at startup; SQLite queries are indexed; server requests paginated.
