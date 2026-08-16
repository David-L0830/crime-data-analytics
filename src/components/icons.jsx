// Central icon registry — one professional icon library (lucide-react) for the
// entire system. Replaces all emoji/Unicode UI icons. Import NAV_ICONS for
// sidebar/nav icon-key lookups, or import individual icons directly for
// one-off usage (buttons, alerts, headers, etc).
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  MapPin,
  BarChart3,
  TrendingUp,
  Scale,
  ScrollText,
  Menu,
  Bell,
  Sun,
  Moon,
  LogOut,
  User,
  Lock,
  Eye,
  EyeOff,
  Search,
  Filter,
  Calendar,
  ChevronDown,
  Download,
  Printer,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Flame,
  Siren,
  Repeat,
  Settings as SettingsIcon,
  X,
  Pencil,
  FileText,
  Image as ImageIcon,
  Upload,
  RefreshCw,
  Trash2,
  Database,
  Tag,
  ArrowUp,
  ArrowDown,
  Layers,
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  IdCard,
  Phone,
  MapPinned,
  Ruler,
  Mail,
  Archive as ArchiveIcon,
  ArrowRight,
  Building2,
  MoreVertical,
  ChevronRight,
  Camera,
} from 'lucide-react';

// Login redesign (BADAC Analytics visual refresh) — small inline icon that
// isn't in the lucide set imported above. Kept as a plain SVG component
// (same 24x24/stroke conventions as lucide) rather than adding a new
// dependency, so it drops straight into the same `<Icons.X size strokeWidth />`
// call sites as everything else in this file.
function Headset({ size = 24, strokeWidth = 2, color = 'currentColor', ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M3 13a9 9 0 0 1 18 0" />
      <path d="M21 13v4a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h3Z" />
      <path d="M3 13v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3Z" />
      <path d="M18 19a4 4 0 0 1-4 2h-1" />
    </svg>
  );
}

// Sidebar / nav icon-key -> component, matches NAV_ITEMS[].icon in constants.js
export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  incidents: ClipboardList,
  mapping: MapPin,
  analytics: BarChart3,
  trends: TrendingUp,
  criminalRecords: Scale,
  auditLogs: ScrollText,
  settings: SettingsIcon,
  userManagement: Users,
};

export const Icons = {
  Menu,
  Users,
  Bell,
  Sun,
  Moon,
  LogOut,
  User,
  Lock,
  Eye,
  EyeOff,
  Search,
  Filter,
  Calendar,
  ChevronDown,
  Download,
  Printer,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Flame,
  Siren,
  Repeat,
  Settings: SettingsIcon,
  Close: X,
  Edit: Pencil,
  Report: FileText,
  Photo: ImageIcon,
  Upload,
  Sync: RefreshCw,
  Delete: Trash2,
  Archive: ArchiveIcon,
  Database,
  Tag,
  Up: ArrowUp,
  Down: ArrowDown,
  Cluster: Layers,
  Back: ArrowLeft,
  Wanted: ShieldAlert,
  Cleared: ShieldCheck,
  IdCard,
  Phone,
  Hotspot: MapPinned,
  Ruler,
  Mail,
  // Login redesign additions
  BarChart3,
  ScrollText,
  ShieldCheck,
  Headset,
  ClipboardList,
  // Public landing page additions
  ArrowRight,
  Building2,
  LayoutDashboard,
  MapPin,
  TrendingUp,
  // Checkpoint 25 — Sidebar (three-dot profile menu, Records submenu chevron,
  // avatar-upload button)
  MoreVertical,
  ChevronRight,
  Camera,
};

export default Icons;
