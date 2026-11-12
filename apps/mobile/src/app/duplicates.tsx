import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dismissMergeSuggestion, useMergeSuggestions, useSettings, type ArtistPair, type ArtistView } from '@/core';
import { attempt } from '@/ui/actions';
import { openMergeName } from '@/ui/components/ArtistAdmin';
import { Artwork } from '@/ui/components/Artwork';
import { Backdrop } from '@/ui/components/Backdrop';
import { EmptyState } from '@/ui/components/EmptyState';
import { Loading } from '@/ui/components/Loading';
import { PressableScale } from '@/ui/components/PressableScale';
import { PrimaryButton } from '@/ui/components/PrimaryButton';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { Text } from '@/ui/components/Text';
import { useReadableColumn } from '@/ui/layout';
import { nav } from '@/ui/nav';
import { makeStyles, radius, space } from '@/ui/theme';

/** Admin: artists that look like the same artist written differently, to merge or dismiss. */
export default function DuplicatesScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const readable = useReadableColumn();
  const { adminMode, adminToken } = useSettings();
  const { pairs, isLoading, error, refetch } = useMergeSuggestions();
  const ready = adminMode && !!adminToken;

  return (
    <View style={styles.root}>
      <Backdrop />
      <ScreenHeader title="Duplicate artists" />
      <ScrollView contentContainerStyle={[readable, { paddingBottom: insets.bottom + space.xl }]}>
        {!ready ? (
          <EmptyState icon="shield-checkmark-outline" title="Admin mode is off" message="Turn on Admin mode and save the admin token in Settings.">
            <PrimaryButton label="Open Settings" variant="surface" onPress={nav.settings} />
          </EmptyState>
        ) : isLoading ? (
          <Loading />
        ) : error ? (
          <EmptyState icon="alert-circle-outline" title="Couldn’t load suggestions" message={error}>
            <PrimaryButton label="Try again" variant="surface" onPress={refetch} />
          </EmptyState>
        ) : !pairs.length ? (
          <EmptyState
            icon="checkmark-circle"
            title="No likely duplicates"
            message="Artists whose names sound alike, also across alphabets, show up here. To merge any two artists, open one and use … → Merge."
          />
        ) : (
          <>
            <Text variant="caption" style={styles.intro}>
              These artists look like the same artist written differently. Merging shows them as one; your files are not changed.
            </Text>
            {pairs.map((p) => (
              <PairCard key={`${p.a.id}:${p.b.id}`} pair={p} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PairCard({ pair }: { pair: ArtistPair }) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.pair}>
        <Side artist={pair.a} />
        <Side artist={pair.b} />
      </View>
      <View style={styles.buttons}>
        <PrimaryButton
          label="Not the same"
          variant="surface"
          onPress={() => void attempt(dismissMergeSuggestion(pair.a.id, pair.b.id))}
          style={styles.flex}
        />
        <PrimaryButton label="Merge…" onPress={() => openMergeName(pair.a, pair.b)} style={styles.flex} />
      </View>
    </View>
  );
}

function Side({ artist }: { artist: ArtistView }) {
  const styles = useStyles();
  return (
    <PressableScale onPress={() => nav.artist(artist.id, 'remote')} accessibilityLabel={`Open ${artist.name}`} style={styles.side}>
      <Artwork uri={artist.artworkUri} label={artist.name} size={56} round />
      <Text variant="bodyStrong" numberOfLines={2} style={styles.center}>
        {artist.name}
      </Text>
      <Text variant="caption">
        {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'}
      </Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  intro: { paddingHorizontal: space.lg, paddingBottom: space.md },
  card: {
    marginHorizontal: space.lg,
    marginBottom: space.md,
    padding: space.lg,
    gap: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pair: { flexDirection: 'row', gap: space.md },
  side: { flex: 1, alignItems: 'center', gap: space.xs },
  center: { textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
}));
