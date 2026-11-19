import { FlashList } from '@shopify/flash-list';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cancelDownload,
  clearFailedDownloads,
  downloadTracks,
  formatBytes,
  retryFailedDownloads,
  useDownloadProgress,
  useDownloads,
  useSettings,
  type ActiveDownload,
} from '@/core';
import { Backdrop } from '@/ui/components/Backdrop';
import { Artwork } from '@/ui/components/Artwork';
import { EmptyState } from '@/ui/components/EmptyState';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { ListRow } from '@/ui/components/ListRow';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { Text } from '@/ui/components/Text';
import { plural } from '@/ui/format';
import { nav } from '@/ui/nav';
import { makeStyles, radius, space, TRACK_ROW_HEIGHT, useColors } from '@/ui/theme';

function statusLabel(item: ActiveDownload, progress: number) {
  if (item.status === 'queued') return 'Waiting…';
  if (item.status === 'error') return item.retrying ? 'Retrying soon…' : `Failed · ${item.error ?? 'tap retry'}`;
  return `Downloading · ${Math.round(progress * 100)}%`;
}

/** A download row, or a section header between the rows still in progress and the failed ones. */
type ListItem = ActiveDownload | { header: string };

const isFailed = (a: ActiveDownload) => a.status === 'error' && !a.retrying;

export default function DownloadsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { active, completedCount, bytesUsed } = useDownloads();
  const { downloadOnWifiOnly } = useSettings();
  // Rows with an automatic retry pending aren't failed yet: they stay in progress.
  const { failed, data } = useMemo(() => {
    const going = active.filter((a) => !isFailed(a));
    const stuck = active.filter(isFailed);
    const list: ListItem[] = [];
    if (going.length) list.push({ header: `IN PROGRESS · ${going.length}` }, ...going);
    if (stuck.length) list.push({ header: `FAILED · ${stuck.length}` }, ...stuck);
    return { failed: stuck.length, data: list };
  }, [active]);

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScreenHeader title="Downloads" />
      <FlashList
        data={data}
        keyExtractor={(a) => ('header' in a ? a.header.split(' ')[0] : a.track.key)}
        getItemType={(a) => ('header' in a ? 'header' : 'row')}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        ListHeaderComponent={
          <View>
            <View style={styles.summary}>
              <View style={styles.stat}>
                <Text variant="title">{formatBytes(bytesUsed)}</Text>
                <Text variant="caption">Storage used</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.stat}>
                <Text variant="title">{completedCount.toLocaleString()}</Text>
                <Text variant="caption">{completedCount === 1 ? 'Song offline' : 'Songs offline'}</Text>
              </View>
            </View>
            <View style={styles.note}>
              <Icon name={downloadOnWifiOnly ? 'wifi' : 'cellular'} size={16} color={colors.textSecondary} />
              <Text variant="caption" style={styles.flex}>
                {downloadOnWifiOnly ? 'Downloads run on Wi-Fi only.' : 'Downloads may use mobile data.'}
              </Text>
            </View>
            <ListRow
              leading={<Artwork uri={null} label="Downloaded" size={44} fallbackIcon="arrow-down" />}
              title="Downloaded music"
              subtitle={plural(completedCount, 'song')}
              chevron
              onPress={() => nav.library('downloaded')}
            />
            {failed > 0 ? (
              <ListRow
                leading={<Artwork uri={null} label="Retry" size={44} fallbackIcon="refresh" />}
                title="Retry failed downloads"
                subtitle={plural(failed, 'song')}
                onPress={() => retryFailedDownloads()}
                nestedActions
                trailing={
                  <IconButton icon="trash-outline" label="Clear failed downloads" color={colors.textSecondary} onPress={clearFailedDownloads} />
                }
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="checkmark-done-outline"
            title="No active downloads"
            message="Download songs from the player or any song’s menu to listen offline."
          />
        }
        renderItem={({ item }) =>
          'header' in item ? (
            <Text variant="micro" style={styles.section} accessibilityRole="header">
              {item.header}
            </Text>
          ) : (
            <ActiveRow item={item} />
          )
        }
      />
    </View>
  );
}

function ActiveRow({ item }: { item: ActiveDownload }) {
  const styles = useStyles();
  const colors = useColors();
  const { track, status } = item;
  const progress = useDownloadProgress(track.key);
  const failed = isFailed(item);
  return (
    <View style={styles.row}>
      <Artwork uri={track.artworkUri} label={track.album || track.title} size={44} recyclingKey={track.key} />
      <View style={styles.meta}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" numberOfLines={1} color={failed ? colors.danger : colors.textSecondary}>
          {statusLabel(item, progress)}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round((status === 'downloading' ? progress : 0) * 100)}%` }]} />
        </View>
      </View>
      {failed ? <IconButton icon="refresh" label="Retry download" onPress={() => downloadTracks([track])} /> : null}
      <IconButton
        icon="close"
        label={failed ? 'Dismiss failed download' : 'Cancel download'}
        color={colors.textSecondary}
        onPress={() => cancelDownload(track.key)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stat: { flex: 1, gap: 2 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.borderStrong, marginHorizontal: space.lg },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  section: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  row: { height: TRACK_ROW_HEIGHT + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.sm },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.surface3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent },
}));
