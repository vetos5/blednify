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
  /** Text / icons drawn on top of `accent`: white or near-black, whichever contrasts more. */
  onAccent: string;
  /** The accent for text and small glyphs on `bg`: nudged towards the ink until it reads at 4.5:1. */
  accentText: string;
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
    accent: '#DC3135',
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
  { id: 'oled', name: 'OLED black', bg: '#000000', accent: '#DC3135' },
  { id: 'aurora', name: 'Aurora', bg: '#05110E', accent: '#2EE6A6', backdrop: 'glow' },
  { id: 'ocean', name: 'Deep ocean', bg: '#06111C', accent: '#38BDF8', backdrop: 'glow' },
  { id: 'amethyst', name: 'Amethyst', bg: '#0D0A16', accent: '#A78BFA', backdrop: 'glow' },
  { id: 'ember', name: 'Ember', bg: '#120A06', accent: '#FB923C' },
  { id: 'light', name: 'Daylight', bg: '#F5F5F7', accent: '#DC3135' },
];

/** Accent swatches offered in Appearance (any hex works). */
export const ACCENT_SWATCHES = [
  '#DC3135',
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

/** Spoken names of the swatches: a screen reader reads the label, and "#DC3135" means nothing aloud. */
export const SWATCH_NAMES: Readonly<Record<string, string>> = {
  '#DC3135': 'Red',
  '#FB923C': 'Orange',
  '#F5C451': 'Yellow',
  '#A3E635': 'Lime',
  '#2EE6A6': 'Mint',
  '#22D3EE': 'Cyan',
  '#38BDF8': 'Sky blue',
  '#6366F1': 'Indigo',
  '#A78BFA': 'Violet',
  '#F472B6': 'Pink',
  '#F5F5F7': 'White',
  '#0A0A0C': 'Near black',
  '#000000': 'Black',
  '#060A1A': 'Midnight blue',
  '#05110E': 'Deep green',
  '#0D0A16': 'Deep purple',
  '#120A06': 'Deep brown',
  '#1A1A1E': 'Graphite',
  '#FFF8EE': 'Warm white',
};

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

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `mix(ink, bg, t)`, moved towards the ink until small text on `bg` reads at WCAG AA (4.5:1). */
function readableMix(ink: RGB, bg: RGB, t: number): RGB {
  let c = mix(ink, bg, t);
  while (t > 0 && contrast(c, bg) < 4.5) {
    t = Math.max(0, t - 0.02);
    c = mix(ink, bg, t);
  }
  return c;
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const ON_ACCENT_DARK: RGB = [10, 10, 12];

/** `color`, mixed towards `ink` just enough for small text on every one of `grounds` to read at WCAG AA (4.5:1). */
function readableTint(color: RGB, ink: RGB, grounds: readonly RGB[]): RGB {
  const worst = (c: RGB) => Math.min(...grounds.map((g) => contrast(c, g)));
  let c = color;
  for (let t = 0.05; worst(c) < 4.5 && t < 1.001; t += 0.05) c = mix(color, ink, Math.min(1, t));
  return c;
}

/**
 * Accent text and meaningful accent glyphs sit on the background, on cards and sheets (surface, surface2) and on
 * accent-soft chips over a card; the tint must read on the worst of them, not just on `bg`.
 */
function accentTextFor(p: Pick<Palette, 'accent' | 'text' | 'bg' | 'surface' | 'surface2'>): string {
  const accent = parseHex(p.accent) ?? [229, 56, 59];
  const ink = parseHex(p.text) ?? WHITE;
  const surface = parseHex(p.surface) ?? accent;
  const grounds = [p.bg, p.surface, p.surface2].map((h) => parseHex(h)).filter((c): c is RGB => !!c);
  grounds.push(mix(surface, accent, 0.16));
  return toHex(readableTint(accent, ink, grounds));
}

function derivePalette(bgHex: string, accentHex: string, backdrop: Backdrop): Palette {
  const bg = parseHex(bgHex) ?? [10, 10, 12];
  const accent = parseHex(accentHex) ?? [229, 56, 59];
  const isLight = luminance(bg) > 0.4;
  const ink: RGB = isLight ? [17, 17, 20] : [245, 245, 247];
  // Surfaces step towards the ink (lighter on dark themes, darker on light ones), tinted by the background.
  const step = (t: number) => toHex(isLight ? mix(bg, BLACK, t) : mix(bg, WHITE, t));
  const p: Palette = {
    bg: toHex(bg),
    surface: isLight ? '#FFFFFF' : step(0.05),
    surface2: step(isLight ? 0.04 : 0.085),
    surface3: step(isLight ? 0.08 : 0.13),
    border: rgba(isLight ? BLACK : WHITE, 0.08),
    borderStrong: rgba(isLight ? BLACK : WHITE, 0.14),
    text: toHex(ink),
    textSecondary: toHex(readableMix(ink, bg, 0.38)),
    textTertiary: toHex(readableMix(ink, bg, 0.6)),
    accent: toHex(accent),
    accentPressed: toHex(mix(accent, BLACK, 0.16)),
    accentDeep: toHex(mix(accent, BLACK, 0.5)),
    accentSoft: rgba(accent, 0.16),
    onAccent: contrast(accent, WHITE) >= contrast(accent, ON_ACCENT_DARK) ? '#FFFFFF' : toHex(ON_ACCENT_DARK),
    accentText: '', // set below, from the surfaces
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
  return { ...p, accentText: accentTextFor(p) };
}

export function presetById(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

export function paletteFor(pref: ThemePref): Palette {
  const preset = presetById(pref.preset);
  // #E5383B was the brand red before 2026-11-16; white on it was 4.2:1, so saved picks map to the darker red.
  const picked = pref.accent && normalizeHex(pref.accent);
  const accent = (picked && picked.toUpperCase() === '#E5383B' ? '#DC3135' : picked) || preset.accent;
  const bg = (pref.background && normalizeHex(pref.background)) || preset.bg;
  const base = derivePalette(bg, accent, preset.backdrop ?? 'none');
  // Hand-tuned values only apply while the preset's own colors are in use.
  if (!preset.overrides || accent !== preset.accent || bg !== preset.bg) return base;
  const merged = { ...base, ...preset.overrides };
  // Overridden surfaces change what the accent text must read on.
  return { ...merged, accentText: preset.overrides.accentText ?? accentTextFor(merged) };
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

/**
 * Height of a two-line song row at the system font scale: the title and artist lines (bodyStrong 20 + caption 18 +
 * gap 2) grow with the font, the 24 px around them don't. 64 at the default scale; never less. For lists that must
 * know their row height up front (the queue's drag maths); other rows use minHeight and size themselves.
 */
export function trackRowHeight(fontScale: number): number {
  return Math.max(TRACK_ROW_HEIGHT, Math.ceil(40 * (fontScale || 1) + 24));
}

/** Deep, desaturated tile gradients for artwork fallbacks — brand-red first. */
const FALLBACK_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#DC3135', '#5C0F12'],
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
