import { StyleSheet, View } from 'react-native';

import { audioQuality, formatSampleRate, useServerTrack, type AppTrack, type QualityLevel } from '@/core';
import { Icon, type IconName } from '@/ui/components/Icon';
import { Text } from '@/ui/components/Text';
import { makeStyles, radius, space, useColors } from '@/ui/theme';
import { useGlassSurface } from '../../chrome';

const LEVEL_LABEL: Record<QualityLevel, string> = {
  lossless: 'Lossless',
  high: 'High quality',
  low: 'Low quality',
  unknown: 'Unknown quality',
};
const LEVEL_ICON: Record<QualityLevel, IconName> = {
  lossless: 'checkmark-circle',
  high: 'checkmark-circle',
  low: 'alert-circle',
  unknown: 'information-circle-outline',
};

/** Player card: audio format, bitrate (amber when low for its format), sample rate and the song's tags. */
export function FileInfoCard({ track }: { track: AppTrack }) {
  const styles = useStyles();
  const glass = useGlassSurface();
  const colors = useColors();
  // Stored copies (likes, queue) may predate the server's stream details: ask for the current ones.
  const { track: fresh } = useServerTrack(track.origin === 'remote' ? track.id : '');
  const t = fresh ?? track;
  const q = audioQuality(t);
  const low = q.level === 'low';
  const tone = low ? colors.warning : q.level === 'unknown' ? colors.textSecondary : colors.success;

  const rate = q.kbps ? `${q.estimated ? '≈ ' : ''}${q.kbps} kbps` : null;
  const rows: [string, string][] = [];
  if (t.sampleRate) rows.push(['Sample rate', formatSampleRate(t.sampleRate)]);
  if (t.bitDepth) rows.push(['Bit depth', `${t.bitDepth}-bit`]);
  if (t.genre) rows.push(['Genre', t.genre]);
  if (t.year) rows.push(['Year', String(t.year)]);
  if (t.trackNumber) rows.push(['Track', t.discNumber ? `${t.trackNumber} · disc ${t.discNumber}` : String(t.trackNumber)]);

  return (
    <View style={[styles.card, glass]}>
      <Text variant="subheading">About the file</Text>
      <View style={styles.hero}>
        <Text variant="heading" color={low ? colors.warning : colors.text} style={styles.flex} numberOfLines={1}>
          {[q.format, rate].filter(Boolean).join(' · ')}
        </Text>
        <View style={[styles.pill, { backgroundColor: `${tone}29`, borderColor: `${tone}66` }]}>
          <Icon name={LEVEL_ICON[q.level]} size={14} color={tone} />
          <Text variant="caption" color={tone} style={styles.pillText}>
            {LEVEL_LABEL[q.level]}
          </Text>
        </View>
      </View>
      {low && q.goodFrom ? (
        <Text variant="caption" color={colors.textSecondary}>
          {q.format} sounds best from {q.goodFrom} kbps.
        </Text>
      ) : null}
      {rows.length ? (
        <View style={styles.rows}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text variant="caption" color={colors.textSecondary}>
                {label}
              </Text>
              <Text variant="bodyStrong" numberOfLines={1} style={styles.value}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, minWidth: 0 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontWeight: '700' },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.sm, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  value: { flexShrink: 1, textAlign: 'right' },
}));
