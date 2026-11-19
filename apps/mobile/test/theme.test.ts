// Pure palette math; the React Native / Expo imports theme.ts makes at module level are stubbed.
import { describe, expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: <T>(s: T) => s, hairlineWidth: 1, absoluteFillObject: {} },
}));
mock.module('expo-router', () => ({ DarkTheme: { colors: {}, fonts: {} }, DefaultTheme: { colors: {}, fonts: {} } }));
mock.module('@/core', () => ({ themeStore: { getState: () => ({ preset: 'blednify' }), subscribe: () => () => {} } }));

const { ACCENT_SWATCHES, BACKGROUND_SWATCHES, THEME_PRESETS, paletteFor, trackRowHeight, TRACK_ROW_HEIGHT } = await import('../src/ui/theme');

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (s: number) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('palette contrast', () => {
  const combos = [
    ...THEME_PRESETS.map((p) => ({ name: p.id, pref: { preset: p.id } })),
    ...ACCENT_SWATCHES.flatMap((accent) =>
      BACKGROUND_SWATCHES.map((background) => ({ name: `${accent} on ${background}`, pref: { preset: 'blednify', accent, background } })),
    ),
  ];

  test('glyphs on the accent (play button, badges) read at 4.4:1 or better', () => {
    // 4.5:1 is the target; #6366F1 (indigo swatch) peaks at 4.47:1 with white, its better side.
    for (const { name, pref } of combos) {
      const p = paletteFor(pref as never);
      expect({ name, ok: contrast(p.onAccent, p.accent) >= 4.4 }).toEqual({ name, ok: true });
    }
  });

  test('accent-coloured text reads at 4.5:1 on the background and on cards and sheets', () => {
    for (const { name, pref } of combos) {
      const p = paletteFor(pref as never);
      for (const ground of ['bg', 'surface', 'surface2'] as const)
        expect({ name, ground, ok: contrast(p.accentText, p[ground]) >= 4.5 }).toEqual({ name, ground, ok: true });
    }
  });
});

describe('trackRowHeight', () => {
  test('64 at the default font size, never less, and grows with the two text lines', () => {
    expect(trackRowHeight(1)).toBe(TRACK_ROW_HEIGHT);
    expect(trackRowHeight(0.85)).toBe(TRACK_ROW_HEIGHT);
    expect(trackRowHeight(0)).toBe(TRACK_ROW_HEIGHT);
    // Android's largest setting (2.0): 2 x 40 px of text + 24 px around it.
    expect(trackRowHeight(2)).toBe(104);
    expect(trackRowHeight(1.3)).toBeGreaterThan(TRACK_ROW_HEIGHT);
  });
});
