/**
 * Web audio backend: the subset of expo-audio's `AudioPlaylist` that the engine uses, played through ONE
 * long-lived <audio> element whose `src` is swapped per track.
 *
 * Why not expo-audio's web playlist: it creates a fresh `Audio()` per track. iOS only lets a page start
 * audio from a user gesture, and an element "unlocked" by a tap stays unlocked; a new element created while
 * the screen is locked (auto-advance) is often refused. Reusing one element keeps background auto-advance
 * and lock-screen next/previous working in a Home Screen web app.
 *
 * Auth: media elements cannot send headers. The server accepts its listen token as an HttpOnly cookie
 * (POST /api/session, see `web-session.ts`), so `headers` on sources are ignored here.
 *
 * Lock screen / Control Center: the Media Session API (metadata, play/pause/next/previous/seek, position).
 */
import type { AudioMetadata, AudioPlaylist, AudioPlaylistStatus } from 'expo-audio';

// The engine owns repeat-all and the full queue; read it only when a media button is pressed.
import { player } from './engine';

export type { AudioMetadata, AudioPlaylist, AudioPlaylistStatus } from 'expo-audio';

type Source = { uri: string; name?: string; headers?: Record<string, string> };
type Status = AudioPlaylistStatus & { error?: string; network?: boolean };
type Listener = (s: Status) => void;
type LoopMode = 'none' | 'single' | 'all';

let sharedEl: HTMLAudioElement | null = null;

/** The one audio element for the page's lifetime (see header). */
export function audioElement(): HTMLAudioElement {
  if (!sharedEl) {
    sharedEl = document.createElement('audio');
    sharedEl.preload = 'auto';
    sharedEl.setAttribute('playsinline', '');
    sharedEl.style.display = 'none';
    document.body.appendChild(sharedEl);
  }
  return sharedEl;
}

const hasMediaSession = () => typeof navigator !== 'undefined' && 'mediaSession' in navigator;

let seq = 0;

/** True when `uri` can't be fetched right now (no connection, timeout, or a 5xx/408/429 "try again" status). */
async function isServerUnavailable(uri: string): Promise<boolean> {
  try {
    // AbortSignal.timeout is missing before iOS 16; a hung probe then just resolves later.
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined;
    const res = await fetch(uri, { headers: { Range: 'bytes=0-0' }, credentials: 'include', signal });
    void res.body?.cancel().catch(() => undefined);
    const s = res.status;
    return s === 408 || s === 429 || s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530);
  } catch {
    return true;
  }
}

class WebPlaylist {
  readonly id = `web-playlist-${++seq}`;
  private sources: Source[] = [];
  private index = 0;
  private loaded = -1; // index whose URI is on the element, -1 none
  private loadedUri = '';
  private isLoaded = false;
  private buffering = false;
  private wantPlay = false;
  private loopMode: LoopMode = 'none';
  private listeners = new Set<Listener>();
  private lastEmit = 0;
  private lastPositionSync = 0;
  private dead = false;
  private lockActive = false;
  /** Seek requested before the element knew the duration; applied on `loadedmetadata`. */
  private startAt: number | null = null;
  /** URI already reloaded once after an error the server probe could not explain (see `onError`). */
  private reloadedUri = '';
  private readonly el = audioElement();
  private readonly off: (() => void)[] = [];

  constructor(private readonly updateIntervalMs: number) {
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => {
      this.el.addEventListener(type, fn);
      this.off.push(() => this.el.removeEventListener(type, fn));
    };
    on('loadedmetadata', () => {
      if (this.startAt !== null) {
        const t = this.startAt;
        this.startAt = null;
        try {
          this.el.currentTime = t;
        } catch {
          // Not seekable; play from the start.
        }
      }
      this.emit();
    });
    on('loadeddata', () => {
      this.reloadedUri = '';
      this.isLoaded = true;
      this.buffering = false;
      this.emit();
    });
    on('canplay', () => {
      this.isLoaded = true;
      this.buffering = false;
      this.emit();
    });
    on('waiting', () => {
      this.buffering = true;
      this.emit();
    });
    on('playing', () => {
      this.buffering = false;
      this.emit();
    });
    on('play', () => {
      // Started from outside the app (Control Center, headphones): adopt it.
      this.wantPlay = true;
      this.emit();
    });
    on('pause', () => {
      // A src swap pauses the element too (readyState is back to HAVE_NOTHING then); that is not the user.
      if (!this.el.ended && this.el.readyState > 0) this.wantPlay = false;
      this.emit();
    });
    on('seeked', () => this.emit());
    on('timeupdate', () => {
      const now = Date.now();
      if (now - this.lastEmit >= this.updateIntervalMs) this.emit();
    });
    on('ended', () => this.onEnded());
    on('error', () => this.onError());
  }

  // --- AudioPlaylist surface used by the engine ---------------------------------------------

  get currentIndex(): number {
    return this.index;
  }

  get trackCount(): number {
    return this.sources.length;
  }

  get loop(): LoopMode {
    return this.loopMode;
  }

  set loop(v: LoopMode) {
    this.loopMode = v;
    this.el.loop = v === 'single';
  }

  addListener(_event: 'playlistStatusUpdate', fn: Listener): { remove(): void } {
    this.listeners.add(fn);
    return { remove: () => this.listeners.delete(fn) };
  }

  play(): void {
    if (this.dead || !this.sources.length) return;
    this.wantPlay = true;
    this.attachCurrent();
    this.startElement();
  }

  pause(): void {
    this.wantPlay = false;
    this.el.pause();
    this.emit();
  }

  next(): void {
    if (this.index + 1 < this.sources.length) this.goTo(this.index + 1);
    else if (this.loopMode === 'all' && this.sources.length) this.goTo(0);
  }

  previous(): void {
    if (this.index > 0) this.goTo(this.index - 1);
    else if (this.loopMode === 'all' && this.sources.length) this.goTo(this.sources.length - 1);
  }

  skipTo(i: number): void {
    if (i < 0 || i >= this.sources.length) return;
    this.index = i;
    this.emit();
    this.scheduleAttach();
  }

  /**
   * Before the element has metadata the position is remembered and applied on `loadedmetadata`, so the engine
   * can seek and call `play()` in the same tap: iOS only honours `play()` inside the user gesture.
   */
  async seekTo(seconds: number): Promise<void> {
    if (this.loaded !== this.index) this.attachCurrent();
    const t = Math.max(0, seconds);
    if (this.el.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.startAt = t;
      return;
    }
    this.startAt = null;
    try {
      this.el.currentTime = t;
    } catch {
      // Not seekable; keep playing from where it is.
    }
  }

  add(source: Source): void {
    this.sources.push(source);
    this.emit();
    this.scheduleAttach();
  }

  remove(i: number): void {
    if (i < 0 || i >= this.sources.length) return;
    this.sources.splice(i, 1);
    if (i < this.index) {
      this.index--;
      if (this.loaded >= 0) this.loaded--;
    } else if (i === this.index) {
      this.loaded = -1;
      this.index = Math.min(this.index, Math.max(0, this.sources.length - 1));
      if (this.sources.length) this.scheduleAttach();
      else this.detach();
    }
    this.emit();
  }

  clear(): void {
    this.sources = [];
    this.index = 0;
    this.detach();
    this.emit();
  }

  destroy(): void {
    this.clearLockScreenControls();
    this.clear();
    this.dead = true;
    this.off.splice(0).forEach((f) => f());
    this.listeners.clear();
  }

  release(): void {
    // Nothing native to free; the shared element outlives playlists on purpose.
  }

  setActiveForLockScreen(active: boolean, metadata?: AudioMetadata): void {
    if (!active) return this.clearLockScreenControls();
    if (!hasMediaSession()) return;
    this.lockActive = true;
    const ms = navigator.mediaSession;
    const handle = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Action not supported by this browser.
      }
    };
    handle('play', () => this.play());
    handle('pause', () => this.pause());
    handle('stop', () => this.pause());
    handle('nexttrack', () => player.next());
    handle('previoustrack', () => player.previous());
    handle('seekto', (d) => {
      if (d.seekTime != null) void this.seekTo(d.seekTime);
    });
    // Without these, iOS shows ±10 s buttons instead of next/previous.
    handle('seekbackward', null as unknown as MediaSessionActionHandler);
    handle('seekforward', null as unknown as MediaSessionActionHandler);
    if (metadata) this.updateLockScreenMetadata(metadata);
  }

  updateLockScreenMetadata(m: AudioMetadata): void {
    if (!hasMediaSession() || !this.lockActive) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m.title ?? '',
      artist: m.artist ?? '',
      album: m.albumTitle ?? '',
      artwork: m.artworkUrl ? [{ src: m.artworkUrl, sizes: '512x512' }] : [],
    });
  }

  clearLockScreenControls(): void {
    if (!hasMediaSession() || !this.lockActive) return;
    this.lockActive = false;
    // Keep the action handlers: the engine detaches/re-attaches around every edit, and dropping handlers
    // mid-playback would make the lock screen briefly show seek buttons instead of next/previous.
  }

  // --- Internals ----------------------------------------------------------------------------

  private attachTimer: ReturnType<typeof setTimeout> | null = null;

  /** Point the element at the current source after a batch of edits (clear + adds + skipTo). */
  private scheduleAttach() {
    if (this.attachTimer) return;
    this.attachTimer = setTimeout(() => {
      this.attachTimer = null;
      if (!this.dead) this.attachCurrent();
    }, 0);
  }

  private attachCurrent() {
    const src = this.sources[this.index];
    if (!src) return;
    if (this.loaded === this.index && this.loadedUri === src.uri) return;
    this.loaded = this.index;
    this.loadedUri = src.uri;
    this.isLoaded = false;
    this.buffering = this.wantPlay;
    this.startAt = null;
    this.el.loop = this.loopMode === 'single';
    this.el.src = src.uri;
    this.el.load();
  }

  private detach() {
    this.loaded = -1;
    this.startAt = null;
    this.loadedUri = '';
    this.isLoaded = false;
    this.buffering = false;
    this.el.pause();
    if (this.el.getAttribute('src')) {
      this.el.removeAttribute('src');
      this.el.load();
    }
  }

  private startElement() {
    const p = this.el.play();
    p?.catch((e: unknown) => {
      const name = (e as { name?: string })?.name;
      // AbortError: superseded by a newer load. NotSupportedError: the source failed; the `error` event reports it
      // and may retry, which needs the intent to play kept.
      if (name !== 'NotAllowedError') return;
      // The browser wants a tap first. Report paused, not an error.
      this.wantPlay = false;
      this.emit();
    });
  }

  private goTo(i: number) {
    const resume = this.wantPlay;
    this.index = i;
    this.attachCurrent();
    if (resume) {
      this.wantPlay = true;
      this.startElement();
    }
    this.emit();
  }

  private onEnded() {
    if (this.loopMode === 'single') return; // el.loop handles it
    if (this.index + 1 < this.sources.length) {
      this.goTo(this.index + 1);
      return;
    }
    if (this.loopMode === 'all' && this.sources.length) {
      this.goTo(0);
      return;
    }
    this.wantPlay = false;
    this.emit({ didJustFinish: true });
  }

  private onError() {
    // Detaching (removeAttribute + load) can fire an error for the empty source; only report real ones.
    if (this.loaded < 0 || !this.el.getAttribute('src')) return;
    const err = this.el.error;
    const reason =
      err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'This audio format is not supported by the browser, or the server refused the request'
        : err?.code === MediaError.MEDIA_ERR_NETWORK
          ? 'Network error while loading the track'
          : err?.code === MediaError.MEDIA_ERR_DECODE
            ? 'The audio file could not be decoded'
            : 'Track could not be played';
    this.isLoaded = false;
    this.buffering = false;
    const error = err?.message ? `${reason} (${err.message})` : reason;
    if (err?.code === MediaError.MEDIA_ERR_NETWORK || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      this.emit({ error, network: true });
      return;
    }
    // A proxy or tunnel answering 502 looks like a broken file to the media element. Ask the server directly, so a
    // server hiccup is retried instead of skipping the song.
    const uri = this.loadedUri;
    const slot = this.loaded;
    const position = this.startAt ?? this.el.currentTime;
    void isServerUnavailable(uri).then((network) => {
      if (this.dead || this.loadedUri !== uri || this.loaded !== slot) return;
      // The server answers fine now, but it may have been down when the element asked (a short outage that ends
      // between the two requests). Load once more before calling the file broken, so a recovered server does not
      // skip the song.
      if (!network && this.reloadedUri !== uri) {
        this.reloadedUri = uri;
        this.startAt = position > 0 ? position : null;
        this.buffering = this.wantPlay;
        this.el.load();
        if (this.wantPlay) this.startElement();
        this.emit();
        return;
      }
      this.emit({ error, network });
    });
  }

  private status(): Status {
    const el = this.el;
    const attached = this.loaded === this.index && this.loaded >= 0;
    const duration = attached && Number.isFinite(el.duration) ? el.duration : 0;
    return {
      id: this.id,
      currentIndex: this.index,
      trackCount: this.sources.length,
      currentTime: attached ? (this.startAt ?? el.currentTime) : 0,
      duration,
      playing: attached && !el.paused && !el.ended,
      isBuffering: this.buffering,
      isLoaded: attached && this.isLoaded,
      playbackRate: el.playbackRate,
      muted: el.muted,
      volume: el.volume,
      loop: this.loopMode,
      didJustFinish: false,
    };
  }

  private emit(extra?: Partial<Status>) {
    if (this.dead) return;
    this.lastEmit = Date.now();
    const s = { ...this.status(), ...extra };
    this.syncMediaSession(s);
    for (const fn of [...this.listeners]) fn(s);
  }

  private syncMediaSession(s: Status) {
    if (!hasMediaSession() || !this.lockActive) return;
    const ms = navigator.mediaSession;
    ms.playbackState = s.playing || (this.wantPlay && s.isBuffering) ? 'playing' : 'paused';
    const now = Date.now();
    if (s.duration > 0 && now - this.lastPositionSync > 1000) {
      this.lastPositionSync = now;
      try {
        ms.setPositionState({ duration: s.duration, position: Math.min(s.currentTime, s.duration), playbackRate: 1 });
      } catch {
        // Invalid state during transitions.
      }
    }
  }
}

export function createAudioPlaylist(opts: { updateInterval?: number; loop?: LoopMode } = {}): AudioPlaylist {
  const p = new WebPlaylist(opts.updateInterval ?? 500);
  if (opts.loop) p.loop = opts.loop;
  return p as unknown as AudioPlaylist;
}

/** Browsers have no audio session to configure. */
export async function setAudioModeAsync(_mode: unknown): Promise<void> {}

/** No media notification permission on the web. */
export async function requestNotificationPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: true };
}
