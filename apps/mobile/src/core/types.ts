export type Origin = 'remote' | 'local'; // remote = from server, local = user-imported file

export type AppTrack = {
  key: string; // globally unique: `r:${remoteId}` or `l:${localId}`
  id: string; // remote track id or local id
  origin: Origin;
  title: string;
  artist: string;
  album: string;
  albumId: string; // remote: server albumId; local: `l:` + hash(artist+album)
  artistId: string;
  durationMs: number;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  mimeType: string;
  sizeBytes: number;
  artworkUri: string | null; // http(s) URL or file:// — pass straight to expo-image
  streamUri: string; // what the player loads: local file if present, else server stream URL
  localUri: string | null; // file:// when downloaded or imported, else null
  addedAt: string;
  /** Server track whose info the admin edited (absent on older snapshots). */
  edited?: boolean;
  /** Stream details from the server (absent on older snapshots and on-device files). kbps / Hz. */
  bitrate?: number | null;
  codec?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  lossless?: boolean;
};

export type AlbumView = {
  id: string;
  origin: Origin;
  title: string;
  artist: string;
  artistId: string;
  year: number | null;
  trackCount: number;
  durationMs: number;
  artworkUri: string | null;
};

export type ArtistView = {
  id: string;
  origin: Origin;
  name: string;
  /** Other spellings shown as this artist (server artists). */
  aliases?: string[];
  /** Other artists were merged into it (server artists). */
  merged?: boolean;
  albumCount: number;
  trackCount: number;
  artworkUri: string | null;
};

export type Playlist = {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
  artworkUris: string[]; // up to 4 for mosaic; an imported playlist's own cover alone
  /** Server import job this playlist mirrors (Spotify / SoundCloud / YouTube link), else null. */
  importId: string | null;
};

export type RepeatMode = 'off' | 'all' | 'one';

export type DownloadStatus = 'none' | 'queued' | 'downloading' | 'done' | 'error';

export type PlayerState = {
  queue: AppTrack[];
  index: number;
  current: AppTrack | null;
  isPlaying: boolean;
  isBuffering: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  error: string | null;
  /** Increments on every playback error, so repeated identical messages are still distinguishable. */
  errorId: number;
};
