// Public API of the core layer — see docs/MOBILE_ARCH.md. UI imports only from '@/core'.

export type {
  AlbumView,
  AppTrack,
  ArtistView,
  DownloadStatus,
  Origin,
  PlayerState,
  Playlist,
  RepeatMode,
} from './types';

// Provider
export { CoreProvider } from './provider';
export { serverUrlProblem } from './api';

// Server catalog
export {
  testServer,
  useAlbum,
  useArtist,
  useRemoteAlbums,
  useRemoteTracks,
  useSearch,
  useServerStatus,
} from './catalog';

// Search history
export {
  clearSearchHistory,
  pushSearchAlbum,
  pushSearchArtist,
  pushSearchQuery,
  pushSearchTrack,
  removeSearchEntry,
  searchHistoryStore,
  useSearchHistory,
  type SearchHistoryAlbum,
  type SearchHistoryArtist,
  type SearchHistoryEntry,
  type SearchHistoryQuery,
  type SearchHistoryTrack,
} from './search-history';

// Local library
export {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
  toggleLike,
  useIsLiked,
  useLikedTracks,
  useLocalAlbums,
  useLocalTracks,
  usePlaylist,
  usePlaylists,
  useRecentlyPlayed,
} from './library';

// Player
export { player } from './player/engine';
export { onProgress, progressStore, usePlayer, useProgress, useProgressSeconds } from './player/store';
export { setVolume, toggleMute, volumeStore, volumeSupported, type VolumeState } from './player/volume';

// Downloads
export { cancelDownload, downloadTracks, removeDownload, useDownloadState, useDownloads } from './downloads';

// Import
export { deleteLocalTrack, importFromDevice } from './import/importer';

// Lyrics
export { activeLyricIndex, hasLyrics, useActiveLyric, useLyrics, usePrefetchLyrics, type LyricLine, type Lyrics } from './lyrics';

// Admin (server uploads / delete / rescan)
export {
  cancelUpload,
  checkAdmin,
  clearUploads,
  deleteFromServer,
  dismissMergeSuggestion,
  editTrackInfo,
  mergeArtists,
  pickAndUpload,
  renameArtist,
  unmergeArtist,
  rescanServer,
  retryUpload,
  uploadLocalTracks,
  useUploads,
  type TrackEdit,
  type UploadItem,
  type UploadStatus,
} from './admin';
export { useArtistSearch, useMergeSuggestions, type ArtistPair } from './artist-admin';

// Playlist imports (Spotify / SoundCloud / YouTube links, downloaded by the server)
export {
  cancelImport,
  dismissImport,
  isActive as isImportActive,
  retryImport,
  startImport,
  useImport,
  useImports,
  type ImportEntry,
  type ImportItem,
  type ImportJob,
  type ImportState,
} from './imports';
export { useAdminInfo } from './admin';

// Library backup
export {
  formatLibraryKey,
  normalizeLibraryKey,
  switchLibraryKey,
  syncLibrary,
  useLibrarySync,
} from './library-sync';

// Sharing
export {
  parseSharedIds,
  shareableIds,
  sharePath,
  shareUrl,
  useServerTrack,
  useServerTracks,
  type ShareTarget,
} from './share';

// Settings
export {
  saveConnection,
  setNavStyle,
  setThemePref,
  themeStore,
  useNavStyle,
  useServerBase,
  useSettings,
  useThemePref,
  type NavStyle,
  type ThemePref,
} from './settings';

// Launcher icon
export { APP_ICONS, appIconById, appIconSupported, setAppIcon, useAppIcon, type AppIconId } from './app-icon';

// Images (adds the access token for server URLs)
export { fileStorageSupported } from './platform';
export { sizedArtworkUrl } from './api';
export { imageSourceFor, useImageSource, type ImageSource } from './auth';

// Utilities
export { audioQuality, formatSampleRate, type AudioQuality, type QualityLevel } from './quality';
export { formatBytes, formatDuration } from './format';
