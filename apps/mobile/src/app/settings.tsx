import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appIconById,
  appIconSupported,
  checkAdmin,
  useAdminInfo,
  formatBytes,
  isCleartextPublic,
  normalizeServerUrl,
  rescanServer,
  saveConnection,
  serverUrlProblem,
  testServer,
  useDownloads,
  useServerStatus,
  useAppIcon,
  useSettings,
  useThemePref,
  useUploads,
  fileStorageSupported,
} from '@/core';
import { attempt, errorMessage, importMusic } from '@/ui/actions';
import { Backdrop } from '@/ui/components/Backdrop';
import { BrandMark } from '@/ui/components/BrandMark';
import { confirm } from '@/ui/components/ConfirmSheet';
import { Icon, type IconName } from '@/ui/components/Icon';
import { LibraryBackupRows } from '@/ui/components/LibraryBackup';
import { ListRow } from '@/ui/components/ListRow';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { Text } from '@/ui/components/Text';
import { plural } from '@/ui/format';
import { heldConfirm } from '@/ui/held';
import { haptics } from '@/ui/haptics';
import { nav } from '@/ui/nav';
import { showToast } from '@/ui/overlay';
import { useReadableColumn } from '@/ui/layout';
import { makeStyles, presetById, radius, space, useColors } from '@/ui/theme';
import { useGlassSurface } from '@/ui/chrome';

type TestResult = { ok: boolean; message: string } | null;

export default function SettingsScreen() {
  const styles = useStyles();
  const glass = useGlassSurface();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const readable = useReadableColumn();
  const settings = useSettings();
  const status = useServerStatus();
  const { bytesUsed, completedCount } = useDownloads();
  const [url, setUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.accessToken);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);

  const normalized = normalizeServerUrl(url);
  const dirty = normalized !== settings.serverUrl || token.trim() !== settings.accessToken;

  const runTest = async () => {
    if (!normalized) return;
    setTesting(true);
    setResult(null);
    try {
      const r = await testServer(normalized, token);
      setResult(
        r.ok
          ? { ok: true, message: `Connected · ${plural(r.trackCount ?? 0, 'song')}` }
          : { ok: false, message: r.error ?? 'Could not reach server' },
      );
      if (r.ok) haptics.success();
      else haptics.warn();
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) });
      haptics.warn();
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const problem = normalized ? serverUrlProblem(normalized) : null;
    if (problem) {
      setResult({ ok: false, message: problem });
      haptics.warn();
      return;
    }
    saveConnection(normalized, token);
    setUrl(normalized);
    setToken(token.trim());
    showToast(normalized ? 'Server saved' : 'Server removed — offline mode', 'success');
  };

  const version = Constants.expoConfig?.version ?? '—';
  const theme = useThemePref();
  const appIcon = useAppIcon();
  const themeLabel = presetById(theme.preset).name + (theme.accent || theme.background ? ' · custom colors' : '');

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={[styles.content, readable, { paddingBottom: insets.bottom + space.xxl }]} keyboardShouldPersistTaps="handled">
        <Section title="Server" icon="server-outline">
          <Text variant="caption">Address of your self-hosted Blednify server. Leave empty to use only music on this phone.</Text>
          <TextInput
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setResult(null);
            }}
            placeholder="http://192.168.1.10:8787"
            accessibilityLabel="Server address"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            returnKeyType="done"
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            onSubmitEditing={runTest}
            style={styles.input}
          />
          <Text variant="caption">
            Access token, only if the server requires one (for example behind a Cloudflare tunnel). Stored on this phone.
          </Text>
          <TextInput
            value={token}
            onChangeText={(v) => {
              setToken(v);
              setResult(null);
            }}
            placeholder="Access token (optional)"
            accessibilityLabel="Access token"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="done"
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            onSubmitEditing={runTest}
            style={styles.input}
          />
          {normalized && isCleartextPublic(normalized) && (token.trim() || settings.adminToken) ? (
            <View style={styles.result}>
              <Icon name="alert-circle-outline" size={16} color={colors.warning} />
              <Text variant="caption" color={colors.warning} style={styles.flex}>
                This address uses http:// over the internet: your tokens travel unencrypted. Use https:// if the server
                supports it.
              </Text>
            </View>
          ) : null}
          {result ? (
            <View style={styles.result}>
              <Icon name={result.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={result.ok ? colors.success : colors.danger} />
              <Text variant="caption" color={result.ok ? colors.success : colors.danger} style={styles.flex}>
                {result.message}
              </Text>
            </View>
          ) : !dirty && settings.serverUrl ? (
            <View style={styles.result}>
              <View
                style={[styles.dot, { backgroundColor: status.online ? colors.success : status.isLoading ? colors.textTertiary : colors.danger }]}
              />
              <Text variant="caption" style={styles.flex}>
                {status.isLoading
                  ? 'Checking…'
                  : status.online
                    ? `Online · ${plural(status.trackCount, 'song')}`
                    : status.needsToken
                      ? 'Server needs the access token below'
                      : 'Offline'}
              </Text>
            </View>
          ) : null}
          <View style={styles.buttons}>
            <PrimaryButton
              label="Test"
              icon="pulse"
              variant="surface"
              onPress={runTest}
              loading={testing}
              disabled={!normalized}
              style={styles.flex}
            />
            <PrimaryButton label="Save" icon="checkmark" onPress={save} disabled={!dirty} style={styles.flex} />
          </View>
        </Section>

        {fileStorageSupported ? (
          <Section title="Downloads" icon="arrow-down-circle-outline">
            <ToggleRow
              title="Download on Wi-Fi only"
              caption="Pause downloads on mobile data."
              value={settings.downloadOnWifiOnly}
              onChange={settings.setDownloadOnWifiOnly}
            />
          </Section>
        ) : null}

        <Section title="Lyrics" icon="text-outline">
          <ToggleRow
            title="Find lyrics online"
            caption="Sends the title and artist of songs imported to this phone to LRCLIB (lrclib.net) to find their lyrics. Server songs use the server’s lookup."
            value={settings.lyricsOnline}
            onChange={settings.setLyricsOnline}
          />
        </Section>

        <AdminSection />

        <View style={[styles.card, glass]}>
          <LibraryBackupRows icon={(name) => <RowIcon name={name} />} />
        </View>

        <View style={[styles.card, glass]}>
          <ListRow
            leading={<RowIcon name="color-palette-outline" />}
            title="Appearance"
            subtitle={themeLabel}
            chevron
            onPress={nav.appearance}
          />
          {appIconSupported ? (
            <ListRow
              leading={<Image source={appIconById(appIcon).image} style={styles.rowAppIcon} />}
              title="App icon"
              subtitle={appIconById(appIcon).name}
              chevron
              onPress={nav.appIcon}
            />
          ) : null}
          {fileStorageSupported ? (
            <>
              <ListRow
                leading={<RowIcon name="folder-outline" />}
                title="Storage used"
                subtitle={`${formatBytes(bytesUsed)} · ${plural(completedCount, 'download')}`}
                chevron
                onPress={nav.downloads}
              />
              <ListRow
                leading={<RowIcon name="add-circle-outline" />}
                title="Import music"
                subtitle="Add audio files from this phone"
                chevron
                onPress={importMusic}
              />
            </>
          ) : null}
        </View>

        <View style={styles.about}>
          <BrandMark size={64} />
          <Text variant="subheading">Blednify</Text>
          <Text variant="caption">Version {version}</Text>
          <Text variant="caption" style={styles.centerText}>
            No ads. No tracking. No accounts.{'\n'}Your music stays on your server and your phone.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function ToggleRow({ title, caption, value, onChange }: { title: string; caption: string; value: boolean; onChange(v: boolean): void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption">{caption}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={(v) => {
          haptics.select();
          onChange(v);
        }}
        trackColor={{ false: colors.surface3, true: colors.accent }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.surface3}
      />
    </View>
  );
}

/** How often opening Settings asks the server again what its last scan held back. */
const ADMIN_RECHECK_MS = 30_000;
let lastAdminCheck = 0;
let adminCheckInFlight = false;

/** Admin mode: upload / delete / rescan on the server with its ADMIN_TOKEN. */
function AdminSection() {
  const styles = useStyles();
  const colors = useColors();
  const settings = useSettings();
  const { active } = useUploads();
  const [token, setToken] = useState(settings.adminToken);
  const [checking, setChecking] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const dirty = token.trim() !== settings.adminToken;
  const info = useAdminInfo();
  const held = info?.held ?? 0;
  const canCheck = settings.adminMode && !!settings.adminToken && !!settings.serverUrl;

  // Learn what the server's last scan held back (an unmounted drive), so the admin sees it without rescanning.
  // Again on each visit (throttled): the server rescans on its own, holding or releasing songs.
  useFocusEffect(
    useCallback(() => {
      if (!canCheck || adminCheckInFlight || Date.now() - lastAdminCheck < ADMIN_RECHECK_MS) return;
      adminCheckInFlight = true;
      // Only an answer counts towards the throttle: after a failed check the next visit asks again.
      void checkAdmin()
        .then((r) => {
          if (r.ok) lastAdminCheck = Date.now();
        })
        .finally(() => {
          adminCheckInFlight = false;
        });
    }, [canCheck]),
  );

  const check = async () => {
    setChecking(true);
    setResult(null);
    const r = await checkAdmin(settings.serverUrl, token);
    setChecking(false);
    setResult(
      r.ok
        ? { ok: true, message: `Admin access OK · uploads up to ${formatBytes(r.maxUploadBytes ?? 0)}` }
        : { ok: false, message: r.error ?? 'Admin check failed' },
    );
    if (r.ok) {
      haptics.success();
      if (dirty) settings.setAdminToken(token);
    } else haptics.warn();
  };

  const rescan = async (confirmRemove?: number) => {
    setRescanning(true);
    const r = await attempt(rescanServer(confirmRemove));
    setRescanning(false);
    if (!r) return;
    if (r.held) {
      const n = r.held;
      // Many songs missing at once is what an unplugged drive looks like: the server waits for this confirmation.
      // Songs with a copy elsewhere move onto it when confirmed; only the rest leave likes and playlists.
      confirm({ ...heldConfirm({ held: n, heldFolders: r.heldFolders, heldWithCopy: r.heldWithCopy }), onConfirm: () => void rescan(n) });
      return;
    }
    showToast(`Rescanned · +${r.added} −${r.removed} · ${plural(r.total, 'song')}`, 'success');
  };

  return (
    <Section title="Admin" icon="shield-checkmark-outline">
      <ToggleRow
        title="Admin mode"
        caption="Upload music to your server and manage its library."
        value={settings.adminMode}
        onChange={settings.setAdminMode}
      />
      {settings.adminMode ? (
        <>
          <Text variant="caption">
            The server’s ADMIN_TOKEN. Stored on this phone and sent only with uploads, deletes and rescans.
          </Text>
          <TextInput
            value={token}
            onChangeText={(v) => {
              setToken(v);
              setResult(null);
            }}
            placeholder="Admin token"
            accessibilityLabel="Admin token"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="done"
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            onSubmitEditing={check}
            style={styles.input}
          />
          {result ? (
            <View style={styles.result}>
              <Icon name={result.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={result.ok ? colors.success : colors.danger} />
              <Text variant="caption" color={result.ok ? colors.success : colors.danger} style={styles.flex}>
                {result.message}
              </Text>
            </View>
          ) : null}
          <View style={styles.buttons}>
            <PrimaryButton
              label="Check"
              icon="key-outline"
              variant="surface"
              onPress={check}
              loading={checking}
              disabled={!token.trim() || !settings.serverUrl}
              style={styles.flex}
            />
            <PrimaryButton
              label="Save"
              icon="checkmark"
              onPress={() => {
                settings.setAdminToken(token);
                showToast('Admin token saved', 'success');
              }}
              disabled={!dirty}
              style={styles.flex}
            />
          </View>
          <View style={styles.adminLinks}>
            {fileStorageSupported ? (
              <ListRow
                leading={<RowIcon name="cloud-upload-outline" />}
                title="Upload music"
                subtitle={active ? `${plural(active, 'file')} in progress` : 'Send audio files from this phone to the server'}
                chevron
                onPress={nav.upload}
              />
            ) : null}
            <ListRow
              leading={<RowIcon name="playlist-import" />}
              title="Import playlist"
              subtitle="Copy a Spotify, SoundCloud or YouTube playlist to the server"
              chevron
              onPress={nav.importPlaylist}
            />
            <ListRow
              leading={<RowIcon name="person-outline" />}
              title="Duplicate artists"
              subtitle="Merge artists written differently, like Пошлая Молли and Poshlaya Molly"
              chevron
              onPress={nav.duplicates}
            />
            {/* Songs held back by the last scan (an unmounted drive?): rescanning shows them again, or asks to remove them. */}
            <ListRow
              leading={<RowIcon name={held > 0 ? 'alert-circle-outline' : 'refresh'} color={held > 0 ? colors.warning : undefined} />}
              title={rescanning ? 'Rescanning…' : held > 0 ? 'Review missing songs' : 'Rescan server library'}
              subtitle={held > 0 ? `${plural(held, 'song')} missing · rescan to review` : 'Pick up files added to the music folder directly'}
              subtitleColor={held > 0 ? colors.warning : undefined}
              onPress={rescanning ? undefined : () => void rescan()}
            />
          </View>
        </>
      ) : null}
    </Section>
  );
}

function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  const styles = useStyles();
  const glass = useGlassSurface();
  const colors = useColors();
  return (
    <View style={[styles.card, glass]}>
      <View style={styles.sectionHead}>
        <Icon name={icon} size={18} color={colors.accentText} />
        <Text variant="micro">{title.toUpperCase()}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function RowIcon({ name, color }: { name: IconName; color?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.rowIcon}>
      <Icon name={name} size={20} color={color ?? colors.text} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.lg },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg },
  sectionBody: { padding: space.lg, gap: space.md },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: Platform.OS === 'web' ? 16 : 15,
    fontWeight: '500',
  },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: space.md },
  adminLinks: { marginHorizontal: -space.lg, marginBottom: -space.lg },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowAppIcon: { width: 40, height: 40, borderRadius: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  about: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  centerText: { textAlign: 'center', marginTop: space.sm },
}));
