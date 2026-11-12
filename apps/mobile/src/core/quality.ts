/** Human-readable audio format and a quality verdict for a track. */
import type { AppTrack } from './types';

export type QualityLevel = 'lossless' | 'high' | 'low' | 'unknown';
export type AudioQuality = {
  /** "MP3", "AAC", "FLAC", … */
  format: string;
  /** kbps; estimated from size and length when the server did not report it. */
  kbps: number | null;
  estimated: boolean;
  level: QualityLevel;
  /** kbps from which this format counts as high quality (null for lossless). */
  goodFrom: number | null;
};

const LOSSLESS = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF', 'WavPack', 'APE']);

function formatName(codec: string | null | undefined, mime: string): string {
  const c = (codec ?? '').toLowerCase();
  if (c.includes('layer 3') || c === 'mp3') return 'MP3';
  if (c.includes('aac')) return 'AAC';
  if (c.includes('alac')) return 'ALAC';
  if (c.includes('flac')) return 'FLAC';
  if (c.includes('opus')) return 'Opus';
  if (c.includes('vorbis')) return 'Vorbis';
  if (c.includes('pcm')) return 'WAV';
  if (c.includes('wavpack')) return 'WavPack';
  if (codec?.trim()) return codec.trim();
  const byMime: Record<string, string> = {
    'audio/mpeg': 'MP3',
    'audio/mp4': 'AAC',
    'audio/aac': 'AAC',
    'audio/flac': 'FLAC',
    'audio/ogg': 'Ogg',
    'audio/wav': 'WAV',
    'audio/x-wav': 'WAV',
  };
  return byMime[mime] ?? (mime.replace(/^audio\//, '').toUpperCase() || 'Audio');
}

/**
 * Format-aware verdict: MP3 is high quality from 320 kbps; AAC, Opus and Vorbis, which sound as good at a
 * lower rate, from 256 kbps; lossless is always fine. Small tolerances absorb VBR averages (e.g. 253 kbps).
 */
export function audioQuality(t: Pick<AppTrack, 'mimeType' | 'sizeBytes' | 'durationMs'> & Partial<AppTrack>): AudioQuality {
  const format = formatName(t.codec, t.mimeType);
  const lossless = t.lossless || LOSSLESS.has(format);
  let kbps = t.bitrate ?? null;
  let estimated = false;
  if (!kbps && t.sizeBytes > 0 && t.durationMs > 0) {
    kbps = Math.round((t.sizeBytes * 8) / t.durationMs);
    estimated = true;
  }
  if (lossless) return { format, kbps, estimated, level: 'lossless', goodFrom: null };
  const goodFrom = format === 'AAC' || format === 'Opus' || format === 'Vorbis' ? 256 : 320;
  const level: QualityLevel = !kbps ? 'unknown' : kbps >= goodFrom * 0.97 ? 'high' : 'low';
  return { format, kbps, estimated, level, goodFrom };
}

/** 44100 → "44.1 kHz". */
export function formatSampleRate(hz: number): string {
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
}
