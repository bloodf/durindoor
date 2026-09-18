import { createElement } from "react";
import {
  Blocks,
  BookOpen,
  Cable,
  CircleQuestionMark,
  Download,
  FileText,
  GitPullRequest,
  Puzzle,
  Rocket,
  Send,
  Server,
  Settings,
  Sparkles,
  Unplug,
  Wrench,
} from "lucide-react";

const ICONS = {
  Blocks,
  BookOpen,
  Cable,
  CircleQuestionMark,
  Download,
  FileText,
  GitPullRequest,
  Puzzle,
  Rocket,
  Send,
  Server,
  Settings,
  Sparkles,
  Unplug,
  Wrench,
};

export function DocsIcon({ name, size = 18, className, ...props }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return createElement(Icon, {
    size,
    className,
    "aria-hidden": true,
    ...props,
  });
}

export function resolveLucideIcon(name) {
  if (!name) return;
  const Icon = ICONS[name];
  if (!Icon) return;
  return createElement(Icon, { "aria-hidden": true });
}
