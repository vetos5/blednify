import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cancelImport,
  checkAdmin,
  dismissImport,
  isImportActive,
  retryImport,
  startImport,
  useAdminInfo,
  useArtistSearch,
  useImports,
  useServerBase,
  useServerStatus,
  useSettings,
  type ImportEntry,
  type ImportJob,
} from '@/core';
import { attempt, errorMessage } from '@/ui/actions';
import { Backdrop } from '@/ui/components/Backdrop';
import { Chip } from '@/ui/components/Chip';
import { Icon } from '@/ui/components/Icon';
import { IconButton } from '@/ui/components/IconButton';
import { PlaylistArtwork } from '@/ui/components/PlaylistArtwork';
import { PressableScale } from '@/ui/components/PressableScale';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { Text } from '@/ui/components/Text';
import { nav } from '@/ui/nav';
import { useReadableColumn } from '@/ui/layout';
import { makeStyles, radius, space, useColors } from '@/ui/theme';

const SOURCE_LABEL = { spotify: 'Spotify', soundcloud: 'SoundCloud', youtube: 'YouTube' } as const;

export default function ImportScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const readable = useReadableColumn();
  const { adminMode, adminToken, serverUrl } = useSettings();
  const status = useServerStatus();
  const info = useAdminInfo();
  const imports = useImports();
  const [url, setUrl] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = adminMode && !!adminToken && !!serverUrl;

  useEffect(() => {
    if (ready && !info) void checkAdmin();
  }, [ready, info]);

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startImport(url, { artist, album });
      setUrl('');
      setArtist('');
      setAlbum('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScreenHeader title="Import playlist" />
      <ScrollView contentContainerStyle={[readable, { paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text variant="bodyStrong">Paste a playlist link</Text>
          <Text variant="caption">
            Spotify playlists, albums and songs, SoundCloud sets and tracks, or YouTube playlists. The server downloads every
            song into its library and you get a playlist with the same name and cover. You can leave this screen; it keeps
            going.
          </Text>
          <TextInput
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setError(null);
            }}
            placeholder="https://open.spotify.com/playlist/…"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            onSubmitEditing={() => void submit()}
            editable={ready}
            style={styles.input}
          />
          <View style={styles.options}>
            <Text variant="micro">OPTIONAL</Text>
            <TextInput
              value={artist}
              onChangeText={setArtist}
              placeholder="Artist for every song"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              editable={ready}
              style={styles.input}
            />
            {ready ? <ArtistChips query={artist} onPick={setArtist} /> : null}
            <TextInput
              value={album}
              onChangeText={setAlbum}
              placeholder="Album for every song"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              editable={ready}
              style={styles.input}
            />
            <Text variant="caption">
              Set an artist for songs uploaded by someone else, like a fan’s SoundCloud uploads of unreleased tracks: every
              song goes under that artist, and “Artist - ” is dropped from titles. Without an album, a SoundCloud set’s
              songs get the set’s name and a single song becomes a single.
            </Text>
          </View>
          {error ? <Warn text={error} danger /> : null}
          {!ready ? (
            <Warn text={!serverUrl ? 'Set a server first.' : 'Turn on Admin mode and save the admin token in Settings.'} danger />
          ) : info && !info.imports ? (
            <Warn text="This server cannot import: it needs yt-dlp and ffmpeg (included in the Docker image). Update the server." danger />
          ) : !status.online && !status.isLoading ? (
            <Warn text="Server looks offline; imports will fail until it is reachable." />
          ) : null}
          <PrimaryButton
            label="Import"
            icon="playlist-import"
            onPress={() => void submit()}
            loading={busy}
            disabled={!ready || !url.trim() || (info !== null && !info.imports)}
          />
          {!ready ? <PrimaryButton label="Open Settings" icon="settings-outline" variant="surface" onPress={nav.settings} /> : null}
        </View>

        {imports.length ? (
          <Text variant="micro" style={styles.section}>
            IMPORTS
          </Text>
        ) : null}
        {imports.map((entry) => (
          <ImportCard key={entry.job.id} entry={entry} />
        ))}
      </ScrollView>
    </View>
  );
}

/** Library artists matching what was typed, so imports land under an existing artist's spelling. */
function ArtistChips({ query, onPick }: { query: string; onPick: (name: string) => void }) {
  const styles = useStyles();
  const typed = query.trim();
  const { artists } = useArtistSearch(typed, 6);
  const matches = typed ? artists.filter((a) => a.name !== typed) : [];
  if (!matches.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
      {matches.map((a) => (
        <Chip key={a.id} label={a.name} icon="person-outline" onPress={() => onPick(a.name)} />
      ))}
    </ScrollView>
  );
}

function Warn({ text, danger }: { text: string; danger?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.warn}>
      <Icon name={danger ? 'alert-circle' : 'information-circle-outline'} size={16} color={danger ? colors.danger : colors.textSecondary} />
      <Text variant="caption" color={danger ? colors.danger : colors.textSecondary} style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

function summary(job: ImportJob): string {
  switch (job.state) {
    case 'queued':
      return 'Waiting for the server…';
    case 'resolving':
      return 'Reading the playlist…';
    case 'running':
      return `${job.done} of ${job.total} songs${job.failed ? ` · ${job.failed} failed` : ''}`;
    case 'done':
      return `${job.done} of ${job.total} songs imported${job.failed ? ` · ${job.failed} not found` : ''}`;
    case 'cancelled':
      return `Cancelled · ${job.done} of ${job.total} imported`;
    case 'failed':
      return job.error ?? 'Import failed';
  }
}

function ImportCard({ entry }: { entry: ImportEntry }) {
  const styles = useStyles();
  const colors = useColors();
  const { job, playlistId } = entry;
  const [open, setOpen] = useState(false);
  const active = isImportActive(job.state);
  const progress = job.total ? (job.done + job.failed) / job.total : 0;
  const cover = job.items.find((i) => i.track?.hasArtwork)?.track;
  const failedItems = job.items.filter((i) => i.state === 'failed');
  const source = job.source ? SOURCE_LABEL[job.source] : null;

  return (
    <View style={styles.job}>
      <PressableScale
        onPress={() => (playlistId ? nav.playlist(playlistId) : setOpen((v) => !v))}
        accessibilityLabel={job.name ?? 'Import'}
        style={styles.jobHead}>
        <View style={styles.art}>
          {playlistId || cover ? (
            <JobArtwork job={job} />
          ) : (
            <Icon name={job.state === 'failed' ? 'alert-circle' : 'playlist-import'} size={24} color={job.state === 'failed' ? colors.danger : colors.text} />
          )}
        </View>
        <View style={styles.meta}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {job.name ?? job.url}
          </Text>
          <Text variant="caption" numberOfLines={2} color={job.state === 'failed' ? colors.danger : colors.textSecondary}>
            {[source, job.owner, job.artist ? `as ${job.artist}` : null].filter(Boolean).join(' · ')}
            {source || job.owner || job.artist ? '\n' : ''}
            {summary(job)}
          </Text>
        </View>
        {active ? (
          <IconButton icon="close" label="Cancel import" color={colors.textSecondary} onPress={() => void attempt(cancelImport(job.id))} />
        ) : job.failed > 0 || job.state === 'failed' ? (
          <IconButton icon="refresh" label="Retry failed songs" onPress={() => void attempt(retryImport(job.id))} />
        ) : (
          <IconButton icon="close" label="Remove from list" color={colors.textSecondary} onPress={() => dismissImport(job.id)} />
        )}
      </PressableScale>
      {active && job.total ? (
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
      {job.warning ? <Warn text={job.warning} /> : null}
      {active ? <CurrentSongs job={job} /> : null}
      {failedItems.length ? (
        <PressableScale onPress={() => setOpen((v) => !v)} accessibilityLabel="Show songs that failed">
          <Text variant="caption" color={colors.textSecondary}>
            {open ? 'Hide' : 'Show'} {failedItems.length} {failedItems.length === 1 ? 'song' : 'songs'} that failed
          </Text>
        </PressableScale>
      ) : null}
      {open
        ? failedItems.map((it, i) => (
            <Text key={i} variant="caption" numberOfLines={2} color={colors.textTertiary}>
              {it.artist ? `${it.artist} – ` : ''}
              {it.title}: {it.error}
            </Text>
          ))
        : null}
    </View>
  );
}

function CurrentSongs({ job }: { job: ImportJob }) {
  const styles = useStyles();
  const colors = useColors();
  const now = job.items.filter((i) => i.state === 'downloading').slice(0, 3);
  if (!now.length) return null;
  return (
    <View style={styles.now}>
      {now.map((it, i) => (
        <Text key={i} variant="caption" numberOfLines={1} color={colors.textTertiary}>
          ↓ {it.artist ? `${it.artist} – ` : ''}
          {it.title}
        </Text>
      ))}
    </View>
  );
}

function JobArtwork({ job }: { job: ImportJob }) {
  const base = useServerBase();
  const fallback = job.items.find((i) => i.track?.hasArtwork)?.track;
  const uri = job.hasCover
    ? `${base}/api/imports/${job.id}/cover`
    : fallback
      ? `${base}/api/tracks/${fallback.id}/artwork`
      : undefined;
  return <PlaylistArtwork uris={uri ? [uri] : []} name={job.name ?? ''} size={56} />;
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  card: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: Platform.OS === 'web' ? 16 : 15,
    fontWeight: '500',
  },
  warn: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  options: { gap: space.sm },
  chips: { gap: space.sm },
  section: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm },
  job: {
    marginHorizontal: space.lg,
    marginBottom: space.md,
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  art: { width: 56, height: 56, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, overflow: 'hidden' },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.surface3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent },
  now: { gap: 2 },
}));
