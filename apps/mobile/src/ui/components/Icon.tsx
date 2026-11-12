import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleArrowDown,
  Copy,
  ExternalLink,
  CircleCheck,
  CircleExclamationPoint,
  CircleMinus,
  CirclePlus,
  CircleX,
  Clock,
  CloudOff,
  Disc,
  EighthNote,
  EighthNotes,
  Ellipsis,
  FastForward,
  Folder,
  FolderOpen,
  Heart,
  House,
  Info,
  Keyboard,
  Key,
  Link,
  Library,
  List,
  ListEnd,
  ListMusic,
  Maximize2,
  Menu,
  Mic,
  MicOff,
  MicVocal,
  Minimize2,
  Pause,
  Palette,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  Shuffle,
  Signal,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Square,
  Trash,
  TrendingUp,
  Type,
  Upload,
  User,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react-native';

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
