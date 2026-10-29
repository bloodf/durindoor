// Reuse the library already used by documentation so action icons share metrics.
import {
  ArrowRight, ArrowUpRight, ArrowLeftRight, AudioLines, BookOpen, Box,
  ChartNoAxesColumn, Check, CircleAlert, Copy, DoorOpen, Eye, Film, Gauge,
  Globe, Image, KeyRound, Layers, LayoutDashboard, Menu, MessageSquare,
  Mic, Network, Pause, Play, Plug, Route, Search, ShieldCheck, Sparkles,
  SquareTerminal, Users, VenetianMask, WandSparkles, Waypoints, X,
} from "lucide-react";

const ICONS = {
  copy: Copy, check: Check, alert: CircleAlert, arrow: ArrowRight,
  external: ArrowUpRight, terminal: SquareTerminal, plug: Plug, key: KeyRound,
  layers: Layers, swap: ArrowLeftRight, chart: ChartNoAxesColumn,
  shield: ShieldCheck, spark: Sparkles, hub: Network, gauge: Gauge,
  wand: WandSparkles, play: Play, pause: Pause, book: BookOpen, box: Box,
  chat: MessageSquare, vector: Waypoints, voice: AudioLines, mic: Mic,
  image: Image, eye: Eye, film: Film, search: Search, globe: Globe,
  route: Route, tunnel: DoorOpen, users: Users, mask: VenetianMask,
  dash: LayoutDashboard, menu: Menu, close: X,
};

export default function Icon({ name, size = 20, className = "", title }) {
  const Glyph = ICONS[name] ?? CircleAlert;
  return <Glyph size={size} strokeWidth={1.7} className={className}
    aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
    aria-label={title} />;
}

// Official GitHub brand artwork remains a brand asset, not a custom UI glyph.
export function GitHubMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.7 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}
