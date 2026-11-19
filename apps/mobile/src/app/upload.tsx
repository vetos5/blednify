import { FlashList } from '@shopify/flash-list';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cancelUpload,
  clearUploads,
  formatBytes,
  pickAndUpload,
  retryUpload,
  useServerStatus,
  useSettings,
  useUploads,
  type UploadItem,
} from '@/core';
import { attempt } from '@/ui/actions';
import { Backdrop } from '@/ui/components/Backdrop';
import { EmptyState } from '@/ui/components/EmptyState';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { Text } from '@/ui/components/Text';
import { nav } from '@/ui/nav';
import { makeStyles, radius, space, TRACK_ROW_HEIGHT, useColors } from '@/ui/theme';

export default function UploadScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { adminMode, adminToken, serverUrl } = useSettings();
  const status = useServerStatus();
  const { items, active, maxUploadBytes } = useUploads();
  const finished = items.length - active;
  const ready = adminMode && !!adminToken && !!serverUrl;

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScreenHeader
        title="Upload to server"
        right={finished > 0 ? <IconButton icon="trash-bin-outline" label="Clear finished" onPress={clearUploads} /> : null}
      />
      <FlashList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        ListHeaderComponent={
          <View style={styles.head}>
            <View style={styles.card}>
              <Text variant="bodyStrong">Add music to your server</Text>
              <Text variant="caption">
                Pick audio files on this phone (mp3, flac, m4a, aac, ogg, opus, wav). They are uploaded one by one and
                appear in everyone’s library.
                {maxUploadBytes ? ` Up to ${formatBytes(maxUploadBytes)} per file.` : ''}
              </Text>
              {!ready ? (
                <View style={styles.warn}>
                  <Icon name="alert-circle" size={16} color={colors.danger} />
                  <Text variant="caption" color={colors.danger} style={styles.flex}>
                    {!serverUrl ? 'Set a server first.' : 'Turn on Admin mode and save the admin token in Settings.'}
                  </Text>
                </View>
              ) : !status.online && !status.isLoading ? (
                <View style={styles.warn}>
                  <Icon name="cloud-offline-outline" size={16} color={colors.textSecondary} />
                  <Text variant="caption" style={styles.flex}>
                    Server looks offline; uploads will fail until it is reachable.
                  </Text>
                </View>
              ) : null}
              <PrimaryButton
                label="Choose files"
                icon="cloud-upload-outline"
                onPress={() => void attempt(pickAndUpload())}
                disabled={!ready}
              />
              {!ready ? <PrimaryButton label="Open Settings" icon="settings-outline" variant="surface" onPress={nav.settings} /> : null}
            </View>
            {items.length ? (
              <Text variant="micro" style={styles.section}>
                {active ? `UPLOADING · ${active} LEFT` : 'DONE'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="cloud-upload-outline" title="Nothing uploaded yet" message="Files you upload show up here with their progress." />
        }
        renderItem={({ item }) => <UploadRow item={item} />}
      />
    </View>
  );
}

function statusText(it: UploadItem): string {
  switch (it.status) {
    case 'queued':
      return `Waiting · ${formatBytes(it.sizeBytes)}`;
    case 'uploading':
      return `Uploading · ${Math.round(it.progress * 100)}% of ${formatBytes(it.sizeBytes)}`;
    case 'done':
      return it.result ? `Added · ${it.result}` : 'Added';
    case 'error':
      return it.error ?? 'Failed';
  }
}

function UploadRow({ item }: { item: UploadItem }) {
  const styles = useStyles();
  const colors = useColors();
  const failed = item.status === 'error';
  const done = item.status === 'done';
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon
          name={done ? 'checkmark-circle' : failed ? 'alert-circle' : 'musical-note'}
          size={22}
          color={done ? colors.success : failed ? colors.danger : colors.text}
        />
      </View>
      <View style={styles.meta}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </Text>
        <Text variant="caption" numberOfLines={1} color={failed ? colors.danger : colors.textSecondary}>
          {statusText(item)}
        </Text>
        {item.status === 'uploading' || item.status === 'queued' ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.round(item.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {failed && item.error !== 'Cancelled' && !item.error?.startsWith('Larger') ? (
        <IconButton icon="refresh" label="Retry upload" onPress={() => retryUpload(item.id)} />
      ) : item.status === 'uploading' || item.status === 'queued' ? (
        <IconButton icon="close" label="Cancel upload" color={colors.textSecondary} onPress={() => cancelUpload(item.id)} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  head: { paddingTop: space.sm },
  card: {
    marginHorizontal: space.lg,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  warn: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  section: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm },
  row: { minHeight: TRACK_ROW_HEIGHT + 8, paddingVertical: space.xs, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.sm },
  rowIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.surface3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent },
}));
