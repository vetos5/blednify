import { usePathname } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useStore } from 'zustand';

import {
  formatDuration,
  player,
  setVolume,
  toggleMute,
  usePlayer,
  useProgress,
  volumeStore,
  type AppTrack,
  type RepeatMode,
} from '@/core';

import { Artwork } from '../components/Artwork';
import { Icon, type IconName } from '../components/Icon';
import { LikeButton } from '../components/LikeButton';
import { Text } from '../components/Text';
import { openTrackActions } from '../components/TrackActions';
import { nav } from '../nav';
import { PLAYER_BAR_HEIGHT } from '../layout';
import { makeStyles, space, useColors } from '../theme';
import { Slider } from './Slider';
import { togglePanel, useDesk, type PanelKind } from './store';
import { Tip } from './Tip';
import { closeNowPlaying, openNowPlaying } from './now-playing';
import { Pressable } from './web';

/** Persistent transport along the bottom of the wide layout. */
export function PlayerBar() {
  const styles = useStyles();
  const current = usePlayer((s) => s.current);
  return (
    <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel="Player">
      <View style={styles.left}>{current ? <NowPlayingInfo track={current} /> : <Idle />}</View>
      <View style={styles.center}>
        <Transport disabled={!current} />
        <Progress track={current} />
      </View>
      <View style={styles.right}>
        <PanelButton panel="lyrics" icon="lyrics" label="Lyrics" shortcut="Y" disabled={!current} />
        <PanelButton panel="queue" icon="queue-list" label="Queue" shortcut="Q" />
        <Volume />
        <ExpandButton disabled={!current} />
      </View>
    </View>
  );
}

function Idle() {
  const colors = useColors();
  return (
    <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
      Pick a song to start listening
    </Text>
  );
}

function NowPlayingInfo({ track }: { track: AppTrack }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <>
      <Tip label="Now playing view">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open now playing view"
          onPress={openNowPlaying}
          onContextMenu={(e: MouseEvent) => {
            e.preventDefault();
            openTrackActions(track, { anchor: { x: e.clientX, y: e.clientY } });
          }}
          style={({ hovered }) => [styles.art, hovered && styles.artHover]}>
          <Artwork uri={track.artworkUri} label={track.album || track.title} size={56} recyclingKey={track.key} priority="high" />
        </Pressable>
      </Tip>
      <View style={styles.meta}>
        <LinkText
          variant="bodyStrong"
          color={colors.text}
          onPress={track.album ? () => goTo(() => nav.album(track.albumId, track.origin)) : undefined}>
          {track.title}
        </LinkText>
        <LinkText variant="caption" color={colors.textSecondary} onPress={() => goTo(() => nav.artist(track.artistId, track.origin))}>
          {track.artist}
        </LinkText>
      </View>
      <LikeButton track={track} size={20} />
    </>
  );
}

function goTo(fn: () => void) {
  closeNowPlaying();
  fn();
}

/** Text that underlines on hover, for title / artist links. */
function LinkText({
  children,
  onPress,
  variant,
  color,
}: {
  children: string;
  onPress?: () => void;
  variant: 'bodyStrong' | 'caption';
  color: string;
}) {
  const styles = useStyles();
  return (
    <Pressable disabled={!onPress} onPress={onPress} accessibilityRole="link" style={styles.link}>
      {({ hovered }) => (
        <Text variant={variant} color={color} numberOfLines={1} style={hovered && onPress ? styles.underline : undefined}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const REPEAT: Record<RepeatMode, { label: string; one?: boolean }> = {
  off: { label: 'Repeat off' },
  all: { label: 'Repeat all' },
  one: { label: 'Repeat one', one: true },
};

function Transport({ disabled }: { disabled: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  return (
    <View style={styles.transport}>
      <BarButton
        icon="shuffle"
        label={shuffle ? 'Shuffle on' : 'Shuffle off'}
        shortcut="S"
        active={shuffle}
        disabled={disabled}
        onPress={player.toggleShuffle}
      />
      <BarButton icon="play-skip-back" label="Previous" shortcut="Shift ←" size={20} disabled={disabled} onPress={player.previous} />
      <Tip label={isPlaying ? 'Pause' : 'Play'} shortcut="Space">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : isBuffering ? 'Loading, pause' : 'Play'}
          accessibilityState={{ busy: isBuffering && !isPlaying, disabled: !!disabled }}
          disabled={disabled}
          onPress={player.togglePlay}
          style={({ hovered, pressed }) => [
            styles.play,
            hovered && styles.playHover,
            pressed && styles.playPressed,
            disabled && styles.dim,
          ]}>
          {isBuffering && !isPlaying ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Icon name={isPlaying ? 'pause' : 'play'} size={20} color={colors.onAccent} />
          )}
        </Pressable>
      </Tip>
      <BarButton icon="play-skip-forward" label="Next" shortcut="Shift →" size={20} disabled={disabled} onPress={player.next} />
      <View>
        <BarButton
          icon="repeat"
          label={REPEAT[repeat].label}
          shortcut="R"
          active={repeat !== 'off'}
          disabled={disabled}
          onPress={player.cycleRepeat}
        />
        {REPEAT[repeat].one ? (
          <View pointerEvents="none" style={styles.badge}>
            <Text style={styles.badgeText}>1</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Progress({ track }: { track: AppTrack | null }) {
  const styles = useStyles();
  const { positionMs, durationMs: live } = useProgress();
  const [scrub, setScrub] = useState<number | null>(null);
  const durationMs = live > 0 ? live : (track?.durationMs ?? 0);
  const value = durationMs > 0 ? positionMs / durationMs : 0;
  const shownMs = scrub !== null ? scrub * durationMs : track ? positionMs : 0;
  return (
    <View style={styles.progress}>
      <Text variant="mono" style={[styles.time, styles.timeLeft]}>
        {formatDuration(shownMs)}
      </Text>
      <View style={styles.flex}>
        <Slider
          label="Seek"
          value={value}
          valueText={`${formatDuration(shownMs)} of ${formatDuration(durationMs)}`}
          step={durationMs > 0 ? 5000 / durationMs : 0.05}
          disabled={!track || durationMs <= 0}
          onScrub={setScrub}
          onCommit={(v) => {
            setScrub(null);
            player.seekTo(Math.round(v * durationMs));
          }}
        />
      </View>
      <Text variant="mono" style={styles.time}>
        {formatDuration(durationMs)}
      </Text>
    </View>
  );
}

function Volume() {
  const styles = useStyles();
  const volume = useStore(volumeStore, (s) => s.volume);
  const muted = useStore(volumeStore, (s) => s.muted);
  const silent = muted || volume === 0;
  return (
    <View style={styles.volume}>
      <BarButton
        icon={silent ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'}
        label={silent ? 'Unmute' : 'Mute'}
        shortcut="M"
        onPress={toggleMute}
      />
      <View style={styles.volumeSlider}>
        <Slider
          label="Volume"
          value={muted ? 0 : volume}
          valueText={`${Math.round((muted ? 0 : volume) * 100)}%`}
          onScrub={setVolume}
          onCommit={setVolume}
        />
      </View>
    </View>
  );
}

function PanelButton({
  panel,
  icon,
  label,
  shortcut,
  disabled,
}: {
  panel: PanelKind;
  icon: IconName;
  label: string;
  shortcut: string;
  disabled?: boolean;
}) {
  const open = useDesk((s) => s.panel === panel);
  return (
    <BarButton icon={icon} label={label} shortcut={shortcut} active={open} dot={open} disabled={disabled} onPress={() => togglePanel(panel)} />
  );
}

function ExpandButton({ disabled }: { disabled: boolean }) {
  const open = usePathname() === '/player';
  return (
    <BarButton
      icon={open ? 'contract-outline' : 'expand-outline'}
      label={open ? 'Close now playing' : 'Now playing view'}
      shortcut="F"
      size={18}
      disabled={disabled && !open}
      onPress={open ? closeNowPlaying : openNowPlaying}
    />
  );
}

export function BarButton({
  icon,
  label,
  shortcut,
  onPress,
  active,
  dot,
  disabled,
  size = 18,
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  onPress: () => void;
  active?: boolean;
  dot?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Tip label={label} shortcut={shortcut}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ hovered, pressed }) => [styles.btn, hovered && styles.btnHover, pressed && styles.btnPressed, disabled && styles.dim]}>
        {({ hovered }) => (
          <>
            <Icon name={icon} size={size} color={active ? colors.accent : hovered ? colors.text : colors.textSecondary} />
            {dot ? <View style={styles.dot} /> : null}
          </>
        )}
      </Pressable>
    </Tip>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    height: PLAYER_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    gap: space.lg,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  left: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  center: { flex: 1.4, flexBasis: 0, maxWidth: 680, alignItems: 'center', gap: 2 },
  right: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  art: { borderRadius: 8, transitionProperty: 'transform', transitionDuration: '160ms' } as object,
  artHover: { transform: [{ scale: 1.04 }] },
  meta: { flexShrink: 1, minWidth: 0, gap: 1 },
  link: { alignSelf: 'flex-start', maxWidth: '100%' },
  underline: { textDecorationLine: 'underline' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  play: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    transitionProperty: 'transform, background-color',
    transitionDuration: '140ms',
  } as object,
  playHover: { transform: [{ scale: 1.06 }] },
  playPressed: { transform: [{ scale: 0.94 }], backgroundColor: colors.accentPressed },
  progress: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  time: { width: 40, fontSize: 11, color: colors.textTertiary },
  timeLeft: { textAlign: 'right' },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: space.xs },
  volumeSlider: { width: 96, marginRight: space.sm },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  btnHover: { backgroundColor: colors.pressed },
  btnPressed: { transform: [{ scale: 0.92 }] },
  dim: { opacity: 0.35 },
  dot: { position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  badge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onAccent, fontSize: 8, lineHeight: 10, fontWeight: '800' },
}));
