import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDuration, useIsLiked, usePlayer, type AppTrack } from '@/core';

import { Pressable as WebPressable } from '../desktop/web';
import { useIsWide, usesFinePointer } from '../layout';
import { nav } from '../nav';
import type { SheetAnchor } from '../overlay';
import { makeStyles, space, TRACK_ROW_HEIGHT, useColors } from '../theme';
import { Artwork } from './Artwork';
import { Equalizer } from './Equalizer';
import { Icon } from './Icon';
import { LikeButton } from './LikeButton';
import { Text } from './Text';
import { spokenLabel } from '../a11y';

export type TrackRowProps = {
  track: AppTrack;
  index: number;
  onPress: (index: number) => void;
  /** `anchor` is set when opened by a right-click in the wide layout. */
  onMore?: (track: AppTrack, index: number, anchor?: SheetAnchor) => void;
  /** `number` shows the album track number instead of artwork. */
  leading?: 'artwork' | 'number';
  subtitle?: 'artist' | 'artist-album';
  showDuration?: boolean;
};

const ARTWORK = 48;

/** Spoken after the title for the current song (0 = not current, 1 = paused, 2 = playing). */
const PLAY_STATE = ['', ', paused', ', now playing'] as const;

function TrackRowImpl(props: TrackRowProps) {
  return useIsWide() ? <WideTrackRow {...props} /> : <PhoneTrackRow {...props} />;
}

function PhoneTrackRow({ track, index, onPress, onMore, leading = 'artwork', subtitle = 'artist', showDuration }: TrackRowProps) {
  const styles = useStyles();
  const colors = useColors();
  // 0 = not current, 1 = current & paused, 2 = current & playing. Primitive selector ⇒ only affected rows re-render.
  const state = usePlayer((s) => (s.current?.key === track.key ? (s.isPlaying ? 2 : 1) : 0));
  const isCurrent = state > 0;
  const downloaded = track.origin === 'remote' && track.localUri !== null;
  const sub = subtitle === 'artist-album' && track.album ? `${track.artist} · ${track.album}` : track.artist;

  return (
    // The "more" button is a sibling of the row's main button, not nested in it: nested buttons are
    // unreachable with a screen reader on web.
    <View style={styles.row}>
    <Pressable
      accessibilityRole="button"
      // The playing bars are decorative; the row itself says it is the current song.
      accessibilityLabel={spokenLabel(`${track.title} by ${track.artist}${PLAY_STATE[state]}`)}
      onPress={() => onPress(index)}
      onLongPress={onMore ? () => onMore(track, index) : undefined}
      delayLongPress={320}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
      {leading === 'artwork' ? (
        <View>
          <Artwork uri={track.artworkUri} label={track.album || track.title} size={ARTWORK} recyclingKey={track.key} />
          {isCurrent ? (
            <View style={styles.eqOverlay}>
              <Equalizer playing={state === 2} size={16} color={colors.white} />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.number}>
          {isCurrent ? (
            <Equalizer playing={state === 2} />
          ) : (
            <Text variant="mono" style={styles.numberText}>
              {track.trackNumber ?? index + 1}
            </Text>
          )}
        </View>
      )}
      <View style={styles.meta}>
        <Text variant="bodyStrong" numberOfLines={1} color={isCurrent ? colors.accentText : colors.text}>
          {track.title}
        </Text>
        <View style={styles.subRow}>
          {downloaded ? <Icon name="arrow-down-circle" size={14} color={colors.accentText} /> : null}
          {track.origin === 'local' ? <Icon name="phone-portrait-outline" size={14} color={colors.textTertiary} /> : null}
          <Text variant="caption" numberOfLines={1} style={styles.subText}>
            {sub}
          </Text>
        </View>
      </View>
      {showDuration ? (
        <Text variant="mono" style={styles.duration}>
          {formatDuration(track.durationMs)}
        </Text>
      ) : null}
    </Pressable>
      {onMore ? (
        <Pressable accessibilityRole="button" accessibilityLabel="More options" hitSlop={10} onPress={() => onMore(track, index)} style={styles.more}>
          <Icon name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const TrackRow = memo(TrackRowImpl);

const WIDE_ROW_HEIGHT = 56;

/**
 * Wide layout row: a table row with album and duration columns. Mouse: click selects, double-click (or
 * Enter, or the play button that replaces the number / cover on hover) plays, right-click opens the menu.
 * Touch (tablets): tap plays, as on phones.
 */
function WideTrackRow({ track, index, onPress, onMore, leading = 'artwork', subtitle = 'artist' }: TrackRowProps) {
  const styles = useStyles();
  const colors = useColors();
  const state = usePlayer((s) => (s.current?.key === track.key ? (s.isPlaying ? 2 : 1) : 0));
  const isCurrent = state > 0;
  const showAlbum = subtitle === 'artist-album';
  const play = () => onPress(index);

  return (
    <WebPressable
      // A group, not a button: the row holds its own buttons (play, artist, album, like, more), and a screen
      // reader can't reach buttons nested inside one.
      accessibilityRole="group"
      accessibilityLabel={`${track.title} by ${track.artist}${PLAY_STATE[state]}`}
      accessibilityHint="Double-click or press Enter to play"
      onPress={(e) => {
        const detail = (e.nativeEvent as unknown as { detail?: number }).detail;
        // Keyboard activation has no click count; touch plays on a single tap.
        if (detail === undefined || detail >= 2 || !usesFinePointer()) play();
      }}
      onContextMenu={
        onMore
          ? (e) => {
              e.preventDefault();
              onMore(track, index, { x: e.clientX, y: e.clientY });
            }
          : undefined
      }
      style={({ hovered, focused }) => [styles.wideRow, hovered && styles.wideHover, focused && styles.wideSelected]}>
      {({ hovered, focused }) => {
        const active = !!(hovered || focused);
        return (
          <>
            <WebPressable accessibilityRole="button" accessibilityLabel={leading !== 'artwork' && !hovered && !isCurrent ? `Play ${track.title}, track ${track.trackNumber ?? index + 1}` : `Play ${track.title}`} onPress={play} style={styles.wideLead}>
              {leading === 'artwork' ? (
                <View>
                  <Artwork uri={track.artworkUri} label={track.album || track.title} size={40} recyclingKey={track.key} />
                  {isCurrent || hovered ? (
                    <View style={styles.eqOverlay}>
                      {hovered ? (
                        <Icon name={state === 2 ? 'pause' : 'play'} size={18} color={colors.white} />
                      ) : (
                        <Equalizer playing={state === 2} size={14} color={colors.white} />
                      )}
                    </View>
                  ) : null}
                </View>
              ) : hovered ? (
                <Icon name={state === 2 ? 'pause' : 'play'} size={16} color={colors.text} />
              ) : isCurrent ? (
                <Equalizer playing={state === 2} />
              ) : (
                <Text variant="mono" style={styles.numberText}>
                  {track.trackNumber ?? index + 1}
                </Text>
              )}
            </WebPressable>
            <View style={styles.wideTitle}>
              <Text variant="bodyStrong" numberOfLines={1} color={isCurrent ? colors.accentText : colors.text} style={styles.wideTitleText}>
                {track.title}
              </Text>
              <WebPressable onPress={() => nav.artist(track.artistId, track.origin)} style={styles.link}>
                {({ hovered: h }) => (
                  <Text variant="caption" numberOfLines={1} color={h ? colors.text : colors.textSecondary} style={h && styles.underline}>
                    {track.artist}
                  </Text>
                )}
              </WebPressable>
            </View>
            {showAlbum ? (
              <View style={styles.wideAlbum}>
                {track.album ? (
                  <WebPressable onPress={() => nav.album(track.albumId, track.origin)} style={styles.link}>
                    {({ hovered: h }) => (
                      <Text variant="caption" numberOfLines={1} color={h ? colors.text : colors.textSecondary} style={h && styles.underline}>
                        {track.album}
                      </Text>
                    )}
                  </WebPressable>
                ) : null}
              </View>
            ) : null}
            <WideLike track={track} visible={active} />
            <Text variant="mono" style={styles.wideDuration}>
              {formatDuration(track.durationMs)}
            </Text>
            {onMore ? (
              <WebPressable
                accessibilityRole="button"
                accessibilityLabel="More options"
                onPress={(e) => {
                  const ne = e.nativeEvent as unknown as { clientX?: number; clientY?: number };
                  onMore(track, index, ne.clientX !== undefined ? { x: ne.clientX ?? 0, y: ne.clientY ?? 0 } : undefined);
                }}
                style={({ hovered: h }) => [styles.wideMore, !active && styles.invisible, h && styles.wideHover]}>
                <Icon name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
              </WebPressable>
            ) : null}
          </>
        );
      }}
    </WebPressable>
  );
}

/** Column titles above a wide-layout track table; renders nothing on phones. */
export function TrackTableHeader({ album }: { album?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  if (!useIsWide()) return null;
  return (
    <View style={[styles.wideRow, styles.tableHeader]}>
      <Text variant="micro" style={[styles.wideLead, styles.headerText, styles.headerCenter]}>
        #
      </Text>
      <Text variant="micro" style={[styles.wideTitle, styles.headerText]}>
        TITLE
      </Text>
      {album ? (
        <Text variant="micro" style={[styles.wideAlbum, styles.headerText]}>
          ALBUM
        </Text>
      ) : null}
      <View style={styles.wideLike} />
      <View style={styles.wideDuration}>
        <Icon name="time-outline" size={14} color={colors.textTertiary} />
      </View>
      <View style={styles.wideMore} />
    </View>
  );
}

/** Heart that stays visible for liked songs and shows on hover for the rest. */
function WideLike({ track, visible }: { track: AppTrack; visible: boolean }) {
  const styles = useStyles();
  const liked = useIsLiked(track.key);
  return (
    <View style={[styles.wideLike, !visible && !liked && styles.invisible]}>
      <LikeButton track={track} size={16} />
    </View>
  );
}


const useStyles = makeStyles((colors) => ({
  row: { height: TRACK_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.md },
  main: { flex: 1, minWidth: 0, height: TRACK_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.md, marginLeft: -space.lg, paddingLeft: space.lg },
  pressed: { backgroundColor: colors.pressed },
  eqOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { width: 28, alignItems: 'center' },
  numberText: { color: colors.textTertiary, fontSize: 14 },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  subText: { flexShrink: 1 },
  duration: { color: colors.textTertiary },
  more: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  wideRow: {
    height: WIDE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.xl,
    paddingHorizontal: space.sm,
    borderRadius: 8,
  },
  wideHover: { backgroundColor: colors.pressed },
  wideSelected: { backgroundColor: colors.surface3 },
  wideLead: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  wideTitle: { flex: 3, minWidth: 0, gap: 1 },
  wideTitleText: { fontSize: 14, lineHeight: 18 },
  wideAlbum: { flex: 2, minWidth: 0 },
  link: { alignSelf: 'flex-start', maxWidth: '100%' },
  underline: { textDecorationLine: 'underline' },
  wideLike: { width: 32, alignItems: 'center' },
  wideDuration: { width: 44, textAlign: 'right', alignItems: 'flex-end', color: colors.textTertiary },
  wideMore: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  invisible: { opacity: 0 },
  tableHeader: {
    height: 36,
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: space.xs,
  },
  headerText: { color: colors.textTertiary, textAlign: 'left', lineHeight: 36 },
  headerCenter: { textAlign: 'center' },
}));
