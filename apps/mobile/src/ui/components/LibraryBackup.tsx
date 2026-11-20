import type { ReactNode } from 'react';
import { Platform, Share, View } from 'react-native';

import { formatLibraryKey, normalizeLibraryKey, switchLibraryKey, syncLibrary, useLibrarySync, useServerBase } from '@/core';

import { haptics } from '../haptics';
import { closeSheet, showSheet, showToast } from '../overlay';
import { makeStyles, radius, space, useColors } from '../theme';
import { SheetHeader } from './ActionSheet';
import { confirm } from './ConfirmSheet';
import { ListRow } from './ListRow';
import { PrimaryButton } from './PrimaryButton';
import { PromptSheet } from './PromptSheet';
import { QrCode } from './QrCode';
import { Text } from './Text';

/** Link that opens "use this library" on another device (web app, iPhone web app, or the Android app). */
export const libraryKeyUrl = (base: string, key: string) => `${base}/library-key?k=${key}`;

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** Settings rows: backup status, the library key, and restoring from another key. */
export function LibraryBackupRows({ icon }: { icon: (name: 'cloud-upload-outline' | 'key-outline' | 'refresh-outline') => ReactNode }) {
  const sync = useLibrarySync();
  const base = useServerBase();
  const status = !base
    ? 'Connect to a server to back up your playlists and likes.'
    : sync.status === 'syncing'
      ? 'Backing up…'
      : sync.status === 'error'
        ? `Couldn’t back up: ${sync.error}`
        : sync.lastSyncedAt
          ? `Playlists and likes backed up · ${ago(sync.lastSyncedAt)}`
          : 'Playlists and likes back up to your server.';
  return (
    <>
      <ListRow
        leading={icon('cloud-upload-outline')}
        title="Library backup"
        subtitle={status}
        onPress={base ? () => void syncLibrary() : undefined}
      />
      {base && sync.key ? (
        <ListRow
          leading={icon('key-outline')}
          title="Library key"
          subtitle="Restores your library on a new phone"
          chevron
          onPress={() => showSheet(<LibraryKeySheet keyValue={sync.key!} base={base} />)}
        />
      ) : null}
      {base ? (
        <ListRow
          leading={icon('refresh-outline')}
          title="Restore a library"
          subtitle="Use the key from another device"
          chevron
          onPress={promptRestore}
        />
      ) : null}
    </>
  );
}

function promptRestore() {
  showSheet(
    <PromptSheet
      title="Library key"
      placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
      submitLabel="Restore"
      // A typo keeps the sheet open with the text, so 25 characters aren't retyped.
      validate={(value) => (normalizeLibraryKey(value) ? null : 'That isn’t a library key. It has 25 letters and digits.')}
      onSubmit={(value) => {
        const key = normalizeLibraryKey(value);
        if (key) confirmSwitch(key);
      }}
    />,
  );
}

/** Asks before switching: the current library on this device is merged into the other one. */
export function confirmSwitch(key: string, onDone?: () => void) {
  confirm({
    title: 'Use this library?',
    message: 'Its playlists and likes will appear on this device. What is here now is kept and added to it.',
    confirmLabel: 'Use library',
    onConfirm: () => void runSwitch(key, false, onDone),
  });
}

/** Switches and reports what really happened: restored, no library under that key, or a failure. */
async function runSwitch(key: string, allowEmpty: boolean, onDone?: () => void) {
  const r = await switchLibraryKey(key, { allowEmpty });
  if (r.status === 'empty') {
    haptics.warn();
    confirm({
      title: 'No library with this key',
      message: 'The server has no backup under this key. Check it for typos, or start a new library with it.',
      confirmLabel: 'Start new library',
      cancelLabel: 'Keep current',
      onConfirm: () => void runSwitch(key, true, onDone),
    });
    return;
  }
  if (r.status === 'failed') {
    haptics.warn();
    showToast(r.switched ? `Switched, but syncing failed: ${r.error}. It will retry.` : `Couldn’t restore: ${r.error}`, 'error');
    if (r.switched) onDone?.();
    return;
  }
  haptics.success();
  const previous = r.previousKey;
  showToast(
    allowEmpty ? 'New library started' : 'Library restored',
    'success',
    previous && previous !== key ? { label: 'Switch back', onPress: () => confirmSwitchBack(previous) } : undefined,
  );
  onDone?.();
}

/**
 * Going back to the previous key is a switch like any other: it doesn't undo the restore, it takes what is on this
 * device now (the restored playlists and likes included) to the previous library. Say so before doing it.
 */
function confirmSwitchBack(previous: string) {
  confirm({
    title: 'Switch back to your previous library?',
    message:
      'This device goes back to its previous library key. The playlists and likes you just restored stay here and are added to it; nothing is removed.',
    confirmLabel: 'Switch back',
    onConfirm: () => void runSwitch(previous, true),
  });
}

function LibraryKeySheet({ keyValue, base }: { keyValue: string; base: string }) {
  const styles = useStyles();
  const colors = useColors();
  const shown = formatLibraryKey(keyValue);
  const url = libraryKeyUrl(base, keyValue);
  const share = async () => {
    haptics.tap();
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(shown);
        showToast('Key copied', 'success');
        closeSheet();
      } else {
        await Share.share({ message: `My Blednify library key: ${shown}\n${url}` });
      }
    } catch {
      // Dismissed.
    }
  };
  return (
    <View style={styles.root}>
      <SheetHeader title="Library key" subtitle="Keep it somewhere safe" />
      <View style={styles.body}>
        <Text variant="caption" color={colors.textSecondary} style={styles.center}>
          Your playlists and likes are backed up to the server under this key. On a new phone, choose Restore a library and
          enter it, or scan this code.
        </Text>
        <View style={styles.qrFrame}>
          <QrCode value={url} size={200} />
        </View>
        <Text variant="subheading" selectable style={styles.key}>
          {shown}
        </Text>
        <Text variant="caption" color={colors.textTertiary} style={styles.center}>
          Anyone with this key can see and change your playlists. Lose it with your phone and the backup is gone.
        </Text>
        <PrimaryButton
          label={Platform.OS === 'web' ? 'Copy key' : 'Save or send key'}
          icon={Platform.OS === 'web' ? 'copy-outline' : 'share-outline'}
          onPress={() => void share()}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  root: { paddingBottom: space.lg },
  body: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md, alignItems: 'center' },
  qrFrame: { padding: space.sm, borderRadius: radius.lg, backgroundColor: '#FFFFFF' },
  center: { textAlign: 'center' },
  key: { textAlign: 'center', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  button: { alignSelf: 'stretch' },
}));
