// One module per icon: the package barrel pulls every lucide icon (~1.7 MB) into the web bundle.
import Activity from 'lucide-react-native/icons/activity';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import Check from 'lucide-react-native/icons/check';
import CheckCheck from 'lucide-react-native/icons/check-check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import Circle from 'lucide-react-native/icons/circle';
import CircleArrowDown from 'lucide-react-native/icons/circle-arrow-down';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleExclamationPoint from 'lucide-react-native/icons/circle-exclamation-point';
import CircleMinus from 'lucide-react-native/icons/circle-minus';
import CirclePlus from 'lucide-react-native/icons/circle-plus';
import CircleX from 'lucide-react-native/icons/circle-x';
import Clock from 'lucide-react-native/icons/clock';
import CloudOff from 'lucide-react-native/icons/cloud-off';
import Copy from 'lucide-react-native/icons/copy';
import Disc from 'lucide-react-native/icons/disc';
import EighthNote from 'lucide-react-native/icons/eighth-note';
import EighthNotes from 'lucide-react-native/icons/eighth-notes';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import ExternalLink from 'lucide-react-native/icons/external-link';
import FastForward from 'lucide-react-native/icons/fast-forward';
import Folder from 'lucide-react-native/icons/folder';
import FolderOpen from 'lucide-react-native/icons/folder-open';
import Heart from 'lucide-react-native/icons/heart';
import House from 'lucide-react-native/icons/house';
import Info from 'lucide-react-native/icons/info';
import Key from 'lucide-react-native/icons/key';
import Keyboard from 'lucide-react-native/icons/keyboard';
import Library from 'lucide-react-native/icons/library';
import Link from 'lucide-react-native/icons/link';
import List from 'lucide-react-native/icons/list';
import ListEnd from 'lucide-react-native/icons/list-end';
import ListMusic from 'lucide-react-native/icons/list-music';
import Maximize2 from 'lucide-react-native/icons/maximize-2';
import Menu from 'lucide-react-native/icons/menu';
import Mic from 'lucide-react-native/icons/mic';
import MicOff from 'lucide-react-native/icons/mic-off';
import MicVocal from 'lucide-react-native/icons/mic-vocal';
import Minimize2 from 'lucide-react-native/icons/minimize-2';
import Palette from 'lucide-react-native/icons/palette';
import Pause from 'lucide-react-native/icons/pause';
import Pencil from 'lucide-react-native/icons/pencil';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import Repeat from 'lucide-react-native/icons/repeat';
import Search from 'lucide-react-native/icons/search';
import Server from 'lucide-react-native/icons/server';
import Settings from 'lucide-react-native/icons/settings';
import Share2 from 'lucide-react-native/icons/share-2';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Shuffle from 'lucide-react-native/icons/shuffle';
import Signal from 'lucide-react-native/icons/signal';
import SkipBack from 'lucide-react-native/icons/skip-back';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Square from 'lucide-react-native/icons/square';
import Trash from 'lucide-react-native/icons/trash';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import Type from 'lucide-react-native/icons/type';
import Upload from 'lucide-react-native/icons/upload';
import User from 'lucide-react-native/icons/user';
import Volume1 from 'lucide-react-native/icons/volume-1';
import Volume2 from 'lucide-react-native/icons/volume-2';
import VolumeX from 'lucide-react-native/icons/volume-x';
import Wifi from 'lucide-react-native/icons/wifi';
import X from 'lucide-react-native/icons/x';
import type { LucideIcon } from 'lucide-react-native';

import Svg, { Path } from 'react-native-svg';

import { useColors } from '../theme';

type IconEntry = {
  icon: LucideIcon;
  fill?: boolean;
  strokeWidth?: number;
};

const ICON_MAP = {
  // Actions & basic controls
  add: { icon: Plus },
  'add-circle': { icon: CirclePlus },
  'add-circle-outline': { icon: CirclePlus },
  close: { icon: X },
  'close-circle': { icon: CircleX },
  'close-circle-outline': { icon: CircleX },
  checkmark: { icon: Check },
  'checkmark-circle': { icon: CircleCheck },
  'ellipse-outline': { icon: Circle },
  'checkmark-done-outline': { icon: CheckCheck },
  'remove-circle-outline': { icon: CircleMinus },
  'pencil-outline': { icon: Pencil },
  'color-palette-outline': { icon: Palette },
  sparkles: { icon: Sparkles },
  trash: { icon: Trash },
  'trash-outline': { icon: Trash },
  'trash-bin-outline': { icon: Trash },
  refresh: { icon: RefreshCw },
  'refresh-outline': { icon: RefreshCw },

  // Chevrons & navigation
  'chevron-back': { icon: ChevronLeft },
  'chevron-back-outline': { icon: ChevronLeft },
  'chevron-down': { icon: ChevronDown },
  'chevron-down-outline': { icon: ChevronDown },
  'chevron-forward': { icon: ChevronRight },
  'chevron-forward-outline': { icon: ChevronRight },
  'chevron-up': { icon: ChevronUp },
  'chevron-up-outline': { icon: ChevronUp },
  'arrow-back': { icon: ArrowLeft },
  'arrow-back-outline': { icon: ArrowLeft },
  'arrow-down': { icon: ArrowDown },
  'arrow-down-circle': { icon: CircleArrowDown },
  'arrow-down-circle-outline': { icon: CircleArrowDown },
  'arrow-forward': { icon: ArrowRight },
  'arrow-forward-outline': { icon: ArrowRight },

  // Tab bar (active vs outline)
  home: { icon: House }, // rendered by HomeFilled below
  'home-outline': { icon: House },
  search: { icon: Search },
  'search-outline': { icon: Search },
  albums: { icon: Library },
  'albums-outline': { icon: Library },

  // Media playback controls
  play: { icon: Play, fill: true },
  'play-outline': { icon: Play },
  pause: { icon: Pause, fill: true },
  'pause-outline': { icon: Pause },
  'play-skip-back': { icon: SkipBack, fill: true },
  'play-skip-forward': { icon: SkipForward, fill: true },
  'play-forward-outline': { icon: FastForward },
  stop: { icon: Square, fill: true },
  shuffle: { icon: Shuffle },
  repeat: { icon: Repeat },

  // Audio & music concepts
  'musical-note': { icon: EighthNote },
  'musical-notes': { icon: EighthNotes },
  'musical-notes-outline': { icon: EighthNotes },
  disc: { icon: Disc },
  'disc-outline': { icon: Disc },
  list: { icon: ListMusic },
  'list-outline': { icon: List },
  mic: { icon: Mic, fill: true },
  'mic-outline': { icon: Mic },
  'mic-off-outline': { icon: MicOff },

  // Favorites & user
  heart: { icon: Heart, fill: true },
  'heart-outline': { icon: Heart },
  person: { icon: User, fill: true },
  'person-outline': { icon: User },

  // System & device
  cellular: { icon: Signal },
  'cellular-outline': { icon: Signal },
  wifi: { icon: Wifi },
  'wifi-outline': { icon: Wifi },
  'phone-portrait': { icon: Smartphone },
  'phone-portrait-outline': { icon: Smartphone },
  'cloud-offline-outline': { icon: CloudOff },
  'cloud-upload-outline': { icon: Upload },
  'server-outline': { icon: Server },
  'settings-outline': { icon: Settings },
  settings: { icon: Settings },
  'key-outline': { icon: Key },
  'shield-checkmark-outline': { icon: ShieldCheck },
  'folder-outline': { icon: Folder },
  'folder-open-outline': { icon: FolderOpen },

  // Info & feedback
  'alert-circle': { icon: CircleExclamationPoint },
  'alert-circle-outline': { icon: CircleExclamationPoint },
  'information-circle': { icon: Info },
  'information-circle-outline': { icon: Info },
  pulse: { icon: Activity },

  // UI layout & chrome
  'ellipsis-horizontal': { icon: Ellipsis },
  'expand-outline': { icon: Maximize2 },
  'contract-outline': { icon: Minimize2 },
  'reorder-three': { icon: Menu },
  'time-outline': { icon: Clock },
  'share-outline': { icon: Share2 },
  'copy-outline': { icon: Copy },
  'open-outline': { icon: ExternalLink },
  'link-outline': { icon: Link },
  'playlist-import': { icon: ListMusic },
  'text-outline': { icon: Type },
  'trending-up': { icon: TrendingUp },
  'volume-high': { icon: Volume2 },
  'volume-low': { icon: Volume1 },
  'volume-mute': { icon: VolumeX },
  lyrics: { icon: MicVocal },
  keyboard: { icon: Keyboard },
  'queue-list': { icon: ListEnd },
} as const satisfies Record<string, IconEntry>;

export type IconName = keyof typeof ICON_MAP;

export function Icon({
  name,
  size = 22,
  color: colorProp,
  strokeWidth,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const text = useColors().text;
  const color = colorProp ?? text;
  if (name === 'home') return <HomeFilled size={size} color={color} />;
  const entry = ICON_MAP[name];
  if (!entry) return null;
  const Component = entry.icon;
  const sw = strokeWidth ?? 2;
  const fill = 'fill' in entry && entry.fill ? color : 'none';
  return <Component size={size} color={color} fill={fill} strokeWidth={sw} />;
}

/** Solid house with the door cut out (a filled lucide House would fill the door too). */
function HomeFilled({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 10.4 12 4l8 6.4V20h-5.2v-6h-5.6v6H4z"
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
