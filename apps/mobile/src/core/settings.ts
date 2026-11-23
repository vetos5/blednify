import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { create, useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { isCleartextPublic, isLocalHost, normalizeServerUrl } from './hosts';
import { queryClient } from './query-client';

export { isCleartextPublic, isLocalHost, normalizeServerUrl };

/** Single synchronous key-value store for settings and small persisted state. */
export const kv = createMMKV({ id: 'blednify' });

const K_SERVER = 'settings.serverUrl';
const K_WIFI = 'settings.downloadOnWifiOnly';
const K_TOKEN = 'settings.accessToken';
const K_ADMIN = 'settings.adminMode';
const K_ADMIN_TOKEN = 'settings.adminToken';
const K_LYRICS_ONLINE = 'settings.lyricsOnline';
const K_AUTOPLAY = 'settings.autoplay';

type SettingsValues = {
  serverUrl: string;
  accessToken: string;
  downloadOnWifiOnly: boolean;
  /** Shows upload / delete / rescan tools for the configured server. */
  adminMode: boolean;
  /** The server's ADMIN_TOKEN; only sent with admin requests. */
  adminToken: string;
  /** Look up lyrics of imported tracks on lrclib.net (server tracks use the server's lookup). */
  lyricsOnline: boolean;
  /** When what the user played runs out, keep going with related songs (core/player/autoplay.ts). */
  autoplay: boolean;
};

/** The web app is served by the Blednify server itself, so its own origin is the server. */
function defaultWebServer(): string {
  return Platform.OS === 'web' && typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.origin : '';
}

export const settingsStore = create<SettingsValues>(() => ({
  serverUrl: kv.getString(K_SERVER) ?? process.env.EXPO_PUBLIC_API_URL ?? defaultWebServer(),
  accessToken: kv.getString(K_TOKEN) ?? '',
  downloadOnWifiOnly: kv.getBoolean(K_WIFI) ?? true,
  adminMode: kv.getBoolean(K_ADMIN) ?? false,
  adminToken: kv.getString(K_ADMIN_TOKEN) ?? '',
  lyricsOnline: kv.getBoolean(K_LYRICS_ONLINE) ?? true,
  autoplay: kv.getBoolean(K_AUTOPLAY) ?? true,
}));

export const getServerBase = (): string => normalizeServerUrl(settingsStore.getState().serverUrl);

export function useServerBase(): string {
  return normalizeServerUrl(useStore(settingsStore, (s) => s.serverUrl));
}

function setServerUrl(url: string) {
  const v = url.trim();
  kv.set(K_SERVER, v);
  settingsStore.setState({ serverUrl: v });
}

/** Saves the server address and access token together, then refetches everything against them. */
export function saveConnection(url: string, token: string): void {
  setServerUrl(url);
  kv.set(K_TOKEN, token.trim());
  settingsStore.setState({ accessToken: token.trim() });
  void queryClient.invalidateQueries();
}

function setDownloadOnWifiOnly(v: boolean) {
  kv.set(K_WIFI, v);
  settingsStore.setState({ downloadOnWifiOnly: v });
}

function setAdminMode(v: boolean) {
  kv.set(K_ADMIN, v);
  settingsStore.setState({ adminMode: v });
}

function setAdminToken(token: string) {
  kv.set(K_ADMIN_TOKEN, token.trim());
  settingsStore.setState({ adminToken: token.trim() });
}

function setLyricsOnline(v: boolean) {
  kv.set(K_LYRICS_ONLINE, v);
  settingsStore.setState({ lyricsOnline: v });
}

function setAutoplay(v: boolean) {
  kv.set(K_AUTOPLAY, v);
  settingsStore.setState({ autoplay: v });
}

export function useSettings(): SettingsValues & {
  setServerUrl(url: string): void;
  setDownloadOnWifiOnly(v: boolean): void;
  setAdminMode(v: boolean): void;
  setAdminToken(token: string): void;
  setLyricsOnline(v: boolean): void;
  setAutoplay(v: boolean): void;
} {
  const values = useStore(settingsStore, useShallow((s) => s));
  return { ...values, setServerUrl, setDownloadOnWifiOnly, setAdminMode, setAdminToken, setLyricsOnline, setAutoplay };
}

// ---------------------------------------------------------------------------------------------
// Appearance

const K_THEME = 'settings.theme.v1';

/** A theme preset (see ui/theme.ts) plus optional custom colors layered on top of it. */
export type ThemePref = {
  preset: string;
  /** Custom accent `#RRGGBB`, else the preset's. */
  accent: string | null;
  /** Custom background `#RRGGBB` (surfaces and text are derived from it), else the preset's. */
  background: string | null;
};

const DEFAULT_THEME: ThemePref = { preset: 'blednify', accent: null, background: null };

function readTheme(): ThemePref {
  try {
    const raw = kv.getString(K_THEME);
    return raw ? { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<ThemePref>) } : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export const themeStore = create<ThemePref>(readTheme);

export function setThemePref(patch: Partial<ThemePref>): void {
  const next = { ...themeStore.getState(), ...patch };
  kv.set(K_THEME, JSON.stringify(next));
  themeStore.setState(next, true);
}

export function useThemePref(): ThemePref {
  return useStore(themeStore, (s) => s);
}

// ---------------------------------------------------------------------------------------------
// Navigation style

const K_NAV_STYLE = 'settings.navStyle.v1';

/**
 * How the phone layout draws its bottom navigation and mini player: `classic` docks a bar under the
 * content, `floating` and `glass` float pills over it (see ui/chrome).
 */
export type NavStyle = 'classic' | 'floating' | 'glass';

const NAV_STYLES: readonly NavStyle[] = ['classic', 'floating', 'glass'];

function readNavStyle(): NavStyle {
  const raw = kv.getString(K_NAV_STYLE);
  return NAV_STYLES.includes(raw as NavStyle) ? (raw as NavStyle) : 'classic';
}

export const navStyleStore = create<{ style: NavStyle }>(() => ({ style: readNavStyle() }));

export function setNavStyle(style: NavStyle): void {
  kv.set(K_NAV_STYLE, style);
  navStyleStore.setState({ style });
}

export function useNavStyle(): NavStyle {
  return useStore(navStyleStore, (s) => s.style);
}
