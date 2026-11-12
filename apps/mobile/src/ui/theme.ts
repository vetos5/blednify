import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { useStore } from 'zustand';

import { themeStore, type ThemePref } from '@/core';

/** Only moving sheets/cover art opt into a compositor layer; native styles stay unchanged. */
export const webLayer: ViewStyle = Platform.OS === 'web' ? ({ willChange: 'transform' } as ViewStyle) : {};

// ---------------------------------------------------------------------------------------------
// Palette

export type Backdrop = 'none' | 'stars' | 'night' | 'glow';

export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentPressed: string;
  accentDeep: string;
  accentSoft: string;
  /** Text / icons drawn on top of `accent` (dark on light accents). */
  onAccent: string;
  danger: string;
  success: string;
  /** Caution highlight (e.g. low-quality audio): amber, readable on the background. */
  warning: string;
  scrim: string;
  /** Pressed-row highlight, Android ripple, and unfilled progress track (ink at low alpha). */
  pressed: string;
  ripple: string;
  track: string;
  white: string;
  black: string;
  isLight: boolean;
  /** Decoration drawn behind screen content (see components/Backdrop). */
  backdrop: Backdrop;
};

/** A preset is a background + accent; everything else is derived so custom colors stay coherent. */
export type ThemePreset = {
  id: string;
  name: string;
  bg: string;
  accent: string;
  backdrop?: Backdrop;
  /** Hand-tuned overrides on top of the derived palette. */
  overrides?: Partial<Palette>;
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'blednify',
    name: 'Blednify',
    bg: '#0A0A0C',
    accent: '#E5383B',
    overrides: { surface: '#141418', surface2: '#1C1C22', surface3: '#26262E', accentDeep: '#7A1517' },
  },
  { id: 'starry', name: 'Starry night', bg: '#060A1A', accent: '#F5C451', backdrop: 'stars' },
  {
    id: 'night',
    name: 'Stars at night',
    bg: '#1A0038',
    accent: '#A9C1FF',
    backdrop: 'night',
    overrides: {
      surface: '#0A1A4C',
      surface2: '#0E2260',
      surface3: '#16307A',
      border: 'rgba(169,193,255,0.12)',
      borderStrong: 'rgba(169,193,255,0.22)',
      textSecondary: '#AAB5E2',
      textTertiary: '#7482B8',
      accentDeep: '#2B3F9E',
    },
  },
  { id: 'oled', name: 'OLED black', bg: '#000000', accent: '#E5383B' },
  { id: 'aurora', name: 'Aurora', bg: '#05110E', accent: '#2EE6A6', backdrop: 'glow' },
  { id: 'ocean', name: 'Deep ocean', bg: '#06111C', accent: '#38BDF8', backdrop: 'glow' },
  { id: 'amethyst', name: 'Amethyst', bg: '#0D0A16', accent: '#A78BFA', backdrop: 'glow' },
  { id: 'ember', name: 'Ember', bg: '#120A06', accent: '#FB923C' },
  { id: 'light', name: 'Daylight', bg: '#F5F5F7', accent: '#E5383B' },
];

/** Accent swatches offered in Appearance (any hex works). */
export const ACCENT_SWATCHES = [
  '#E5383B',
  '#FB923C',
  '#F5C451',
  '#A3E635',
  '#2EE6A6',
  '#22D3EE',
  '#38BDF8',
  '#6366F1',
  '#A78BFA',
  '#F472B6',
  '#F5F5F7',
] as const;

/** Background swatches offered in Appearance. */
export const BACKGROUND_SWATCHES = [
  '#0A0A0C',
  '#000000',
  '#060A1A',
  '#05110E',
  '#0D0A16',
  '#120A06',
  '#1A1A1E',
  '#F5F5F7',
  '#FFF8EE',
] as const;

// --- Color math ----------------------------------------------------------------------------------

type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** `#RRGGBB` for valid input (3 or 6 digits, `#` optional), else null. */
export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : null;
}

/** `#RRGGBB` + alpha -> `rgba(...)` (for fades built from palette colors). */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  return rgb ? rgba(rgb, alpha) : hex;
}

const toHex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
const rgba = (c: RGB, a: number) => `rgba(${c.map(Math.round).join(',')},${a})`;

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function derivePalette(bgHex: string, accentHex: string, backdrop: Backdrop): Palette {
  const bg = parseHex(bgHex) ?? [10, 10, 12];
  const accent = parseHex(accentHex) ?? [229, 56, 59];
  const isLight = luminance(bg) > 0.4;
  const ink: RGB = isLight ? [17, 17, 20] : [245, 245, 247];
  // Surfaces step towards the ink (lighter on dark themes, darker on light ones), tinted by the background.
  const step = (t: number) => toHex(isLight ? mix(bg, BLACK, t) : mix(bg, WHITE, t));
  return {
    bg: toHex(bg),
    surface: isLight ? '#FFFFFF' : step(0.05),
    surface2: step(isLight ? 0.04 : 0.085),
    surface3: step(isLight ? 0.08 : 0.13),
    border: rgba(isLight ? BLACK : WHITE, 0.08),
    borderStrong: rgba(isLight ? BLACK : WHITE, 0.14),
    text: toHex(ink),
    textSecondary: toHex(mix(ink, bg, 0.38)),
    textTertiary: toHex(mix(ink, bg, 0.6)),
    accent: toHex(accent),
    accentPressed: toHex(mix(accent, BLACK, 0.16)),
    accentDeep: toHex(mix(accent, BLACK, 0.5)),
    accentSoft: rgba(accent, 0.16),
    onAccent: luminance(accent) > 0.45 ? '#0A0A0C' : '#FFFFFF',
    danger: isLight ? '#D92D32' : '#FF5A5F',
    success: isLight ? '#1E9E62' : '#3DD68C',
    warning: isLight ? '#A15C07' : '#F5B83D',
    scrim: isLight ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.6)',
    pressed: rgba(ink, 0.05),
    ripple: rgba(ink, 0.07),
    track: rgba(ink, 0.16),
    white: '#FFFFFF',
    black: '#000000',
    isLight,
    backdrop,
  };
}

export function presetById(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

export function paletteFor(pref: ThemePref): Palette {
  const preset = presetById(pref.preset);
  const accent = (pref.accent && normalizeHex(pref.accent)) || preset.accent;
  const bg = (pref.background && normalizeHex(pref.background)) || preset.bg;
  const base = derivePalette(bg, accent, preset.backdrop ?? 'none');
  // Hand-tuned values only apply while the preset's own colors are in use.
  if (!preset.overrides || accent !== preset.accent || bg !== preset.bg) return base;
  return { ...base, ...preset.overrides };
}

// --- Hooks -----------------------------------------------------------------------------------------

const palettes = new WeakMap<ThemePref, Palette>();

/** Palette for a stored preference; one object per preference, so it is safe as a memo / cache key. */
function paletteOf(pref: ThemePref): Palette {
  let palette = palettes.get(pref);
  if (!palette) {
    palette = paletteFor(pref);
    palettes.set(pref, palette);
  }
  return palette;
}

/** The active palette outside React. */
export const getPalette = (): Palette => paletteOf(themeStore.getState());

const darkVariants = new WeakMap<Palette, Palette>();

/** Same accent on a dark background; for immersive screens drawn over artwork (player, lyrics). */
function darkVariantOf(p: Palette): Palette {
  if (!p.isLight) return p;
  let dark = darkVariants.get(p);
  if (!dark) {
    dark = derivePalette('#0A0A0C', p.accent, 'none');
    darkVariants.set(p, dark);
  }
  return dark;
}

const ForceDarkContext = createContext(false);

/** Children render with a dark palette even when the theme is light. */
export function ForceDark({ children }: { children: ReactNode }) {
  return createElement(ForceDarkContext.Provider, { value: true }, children);
}

export function useColors(): Palette {
  const forceDark = useContext(ForceDarkContext);
  // Pass the store value through so the React Compiler sees the dependency.
  const palette = paletteOf(useStore(themeStore, (s) => s));
  return forceDark ? darkVariantOf(palette) : palette;
}

/**
 * Theme-aware StyleSheet: `const useStyles = makeStyles((colors) => ({ ... }))` at module level, then
 * `const styles = useStyles()` in the component. Built once per palette.
 */
export function makeStyles<T extends Parameters<typeof StyleSheet.create>[0]>(
  factory: (colors: Palette) => T,
): () => Readonly<T> {
  const cache = new WeakMap<Palette, Readonly<T>>();
  return function useStyles() {
    const colors = useColors();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}

// ---------------------------------------------------------------------------------------------
// Static tokens

/** 8pt grid. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const useType = makeStyles(
  (colors) =>
    ({
      display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1.1, color: colors.text },
      title: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8, color: colors.text },
      heading: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4, color: colors.text },
      subheading: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3, color: colors.text },
      body: { fontSize: 15, lineHeight: 20, fontWeight: '500', letterSpacing: -0.1, color: colors.text },
      bodyStrong: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2, color: colors.text },
      caption: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.textSecondary },
      micro: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.6, color: colors.textSecondary },
      mono: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        color: colors.textSecondary,
      },
    }) satisfies Record<string, TextStyle>,
);

export type TypeVariant = keyof ReturnType<typeof useType>;

export const TAB_BAR_HEIGHT = 56;
export const MINI_PLAYER_HEIGHT = 60;
export const TRACK_ROW_HEIGHT = 64;

/** Deep, desaturated tile gradients for artwork fallbacks — brand-red first. */
const FALLBACK_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#E5383B', '#5C0F12'],
  ['#8E2DE2', '#2A0E4A'],
  ['#2B5876', '#101C2B'],
  ['#C06C2B', '#3B1A08'],
  ['#1F8A70', '#0B2B24'],
  ['#B33771', '#3A0E22'],
  ['#4A5BD6', '#141A45'],
];

export function gradientFor(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return FALLBACK_GRADIENTS[Math.abs(h) % FALLBACK_GRADIENTS.length];
}

const navThemes = new WeakMap<Palette, Theme>();

export function navigationThemeFor(colors: Palette): Theme {
  let theme = navThemes.get(colors);
  if (!theme) {
    const base = colors.isLight ? DefaultTheme : DarkTheme;
    theme = {
      ...base,
      dark: !colors.isLight,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.bg,
        card: colors.bg,
        text: colors.text,
        border: colors.border,
        notification: colors.accent,
      },
    };
    navThemes.set(colors, theme);
  }
  return theme;
}
