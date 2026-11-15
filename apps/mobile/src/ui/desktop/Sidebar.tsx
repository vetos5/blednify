import { useGlobalSearchParams, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useLikedTracks, usePlaylists, useServerStatus, type Playlist } from '@/core';

import { Artwork } from '../components/Artwork';
import { BrandMark } from '../components/BrandMark';
import { Icon, type IconName } from '../components/Icon';
import { openPlaylistActions, promptNewPlaylist } from '../components/PlaylistActions';
import { PlaylistArtwork } from '../components/PlaylistArtwork';
import { Text } from '../components/Text';
import { nav, type LibraryFilter } from '../nav';
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from '../layout';
import { makeStyles, radius, space, useColors } from '../theme';
import { requestSearchFocus } from './store';
import { Tip } from './Tip';
import { Pressable } from './web';

/** Left navigation of the wide layout. `rail` collapses it to icons on narrower windows. */
export function Sidebar({ rail }: { rail: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const path = usePathname();
  const { filter } = useGlobalSearchParams<{ filter?: string }>();
  const playlists = usePlaylists();
  const liked = useLikedTracks();
  const libraryFilter = path === '/library' ? (filter ?? 'playlists') : null;

  return (
    <View style={[styles.root, { width: rail ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH }]} accessibilityRole="navigation">
      <View style={[styles.brand, rail && styles.brandRail]}>
        <BrandMark size={28} />
        {rail ? null : (
          <Text variant="subheading" style={styles.wordmark}>
            Blednify
          </Text>
        )}
      </View>

      <View style={styles.group}>
        <NavItem rail={rail} icon="home-outline" iconActive="home" label="Home" active={path === '/'} onPress={() => nav.tab('index')} />
        <NavItem
          rail={rail}
          icon="search-outline"
          iconActive="search"
          label="Search"
          hint="Ctrl K"
          active={path === '/search'}
          onPress={() => {
            nav.tab('search');
            requestSearchFocus();
          }}
        />
        <NavItem
          rail={rail}
          icon="albums-outline"
          iconActive="albums"
          label="Library"
          active={libraryFilter === 'playlists'}
          onPress={() => nav.library('playlists')}
        />
      </View>

      <View style={styles.divider} />

      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <LibraryItem
          rail={rail}
          label="Liked songs"
          sub={`${liked.length} ${liked.length === 1 ? 'song' : 'songs'}`}
          art={<Artwork uri={null} label="Liked" size={rail ? 40 : 36} radius={radius.sm} fallbackIcon="heart" />}
          active={libraryFilter === 'liked'}
          onPress={() => nav.library('liked')}
        />
        <LibraryItem
          rail={rail}
          label="Albums"
          art={<TileIcon icon="disc-outline" rail={rail} />}
          active={libraryFilter === 'albums'}
          onPress={() => nav.library('albums' satisfies LibraryFilter)}
        />
        <LibraryItem
          rail={rail}
          label="Recently played"
          art={<TileIcon icon="time-outline" rail={rail} />}
          active={libraryFilter === 'recents'}
          onPress={() => nav.library('recents')}
        />

        <View style={[styles.sectionRow, rail && styles.sectionRowRail]}>
          {rail ? null : (
            <Text variant="micro" color={colors.textTertiary} style={styles.flex}>
              PLAYLISTS
            </Text>
          )}
          <Tip label="New playlist" side={rail ? 'right' : 'top'}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New playlist"
              onPress={promptNewPlaylist}
              style={({ hovered }) => [styles.addBtn, hovered && styles.hover]}>
              <Icon name="add" size={18} color={colors.textSecondary} />
            </Pressable>
          </Tip>
        </View>
        {playlists.map((p) => (
          <PlaylistItem key={p.id} playlist={p} rail={rail} active={path === `/playlist/${p.id}`} />
        ))}
        {playlists.length === 0 && !rail ? (
          <Text variant="caption" color={colors.textTertiary} style={styles.emptyNote}>
            Right-click any song and choose “Add to playlist”.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.divider} />
      <Footer rail={rail} active={path === '/settings' || path === '/appearance'} />
    </View>
  );
}

function NavItem({
  rail,
  icon,
  iconActive,
  label,
  hint,
  active,
  onPress,
}: {
  rail: boolean;
  icon: IconName;
  iconActive: IconName;
  label: string;
  hint?: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const row = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered }) => [styles.nav, rail && styles.navRail, hovered && styles.hover, active && styles.active]}>
      {({ hovered }) => (
        <>
          <Icon
            name={active ? iconActive : icon}
            size={22}
            strokeWidth={active ? 2.5 : 2}
            color={active || hovered ? colors.text : colors.textSecondary}
          />
          {rail ? null : (
            <Text variant="bodyStrong" color={active || hovered ? colors.text : colors.textSecondary} style={styles.flex}>
              {label}
            </Text>
          )}
          {!rail && hint && hovered ? (
            <Text variant="mono" style={styles.hint}>
              {hint}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
  return rail ? (
    <Tip label={label} shortcut={hint} side="right">
      {row}
    </Tip>
  ) : (
    row
  );
}

function TileIcon({ icon, rail }: { icon: IconName; rail: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const size = rail ? 40 : 36;
  return (
    <View style={[styles.tileIcon, { width: size, height: size }]}>
      <Icon name={icon} size={18} color={colors.textSecondary} />
    </View>
  );
}

function LibraryItem({
  rail,
  label,
  sub,
  art,
  active,
  onPress,
  onContextMenu,
}: {
  rail: boolean;
  label: string;
  sub?: string;
  art: ReactNode;
  active: boolean;
  onPress: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const row = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={sub && !rail ? undefined : label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      {...(onContextMenu ? ({ onContextMenu } as object) : null)}
      style={({ hovered }) => [styles.item, rail && styles.itemRail, hovered && styles.hover, active && styles.active]}>
      {art}
      {rail ? null : (
        <View style={styles.itemText}>
          <Text variant="body" color={active ? colors.accent : colors.text} numberOfLines={1} style={styles.itemTitle}>
            {label}
          </Text>
          {sub ? (
            <Text variant="caption" numberOfLines={1} style={styles.itemSub}>
              {sub}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
  return rail ? (
    <Tip label={label} side="right">
      {row}
    </Tip>
  ) : (
    row
  );
}

function PlaylistItem({ playlist: p, rail, active }: { playlist: Playlist; rail: boolean; active: boolean }) {
  return (
    <LibraryItem
      rail={rail}
      label={p.name}
      sub={`${p.trackCount} ${p.trackCount === 1 ? 'track' : 'tracks'}`}
      art={<PlaylistArtwork uris={p.artworkUris} name={p.name} size={rail ? 40 : 36} />}
      active={active}
      onPress={() => nav.playlist(p.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        openPlaylistActions(p, { anchor: { x: e.clientX, y: e.clientY } });
      }}
    />
  );
}

function Footer({ rail, active }: { rail: boolean; active: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const server = useServerStatus();
  const hasServer = server.serverUrl.length > 0;
  const status = !hasServer
    ? 'No server'
    : server.isLoading
      ? 'Connecting…'
      : server.online
        ? `${server.trackCount.toLocaleString()} tracks`
        : server.needsToken
          ? 'Needs a token'
          : 'Server offline';
  const dot = server.online ? colors.success : server.isLoading ? colors.textTertiary : colors.danger;
  const row = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={rail ? `Settings. Server: ${status}` : undefined}
      onPress={nav.settings}
      style={({ hovered }) => [styles.nav, rail && styles.navRail, hovered && styles.hover, active && styles.active]}>
      {({ hovered }) => (
        <>
          <View>
            <Icon name="settings-outline" size={20} color={active || hovered ? colors.text : colors.textSecondary} />
            <View style={[styles.statusDot, { backgroundColor: dot, borderColor: colors.bg }]} />
          </View>
          {rail ? null : (
            <View style={styles.flex}>
              <Text variant="bodyStrong" color={active || hovered ? colors.text : colors.textSecondary}>
                Settings
              </Text>
              <Text variant="caption" numberOfLines={1} style={styles.itemSub}>
                {status}
              </Text>
            </View>
          )}
        </>
      )}
    </Pressable>
  );
  return <View style={styles.footer}>{rail ? <Tip label={`Settings · ${status}`} side="right">{row}</Tip> : row}</View>;
}

const useStyles = makeStyles((colors) => ({
  root: {
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingTop: space.lg,
    zIndex: 2,
  },
  flex: { flex: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingHorizontal: space.lg + 2, marginBottom: space.lg },
  brandRail: { paddingHorizontal: 0, justifyContent: 'center' },
  wordmark: { letterSpacing: -0.4 },
  group: { paddingHorizontal: space.sm, gap: 2 },
  nav: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  navRail: { justifyContent: 'center', paddingHorizontal: 0 },
  hover: { backgroundColor: colors.pressed },
  active: { backgroundColor: colors.surface3 },
  hint: { fontSize: 10, color: colors.textTertiary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: space.md, marginVertical: space.md },
  scroll: { paddingHorizontal: space.sm, paddingBottom: space.md, gap: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.md, marginTop: space.md, marginBottom: space.xs },
  sectionRowRail: { justifyContent: 'center', paddingLeft: 0 },
  addBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.xs + 2, borderRadius: radius.sm },
  itemRail: { justifyContent: 'center' },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  itemSub: { fontSize: 12, lineHeight: 16 },
  tileIcon: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  emptyNote: { paddingHorizontal: space.md, paddingTop: space.xs },
  footer: { paddingHorizontal: space.sm, paddingBottom: space.md },
  statusDot: { position: 'absolute', right: -3, bottom: -2, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
}));
