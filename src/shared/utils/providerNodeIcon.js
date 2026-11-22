/**
 * Fallback icon text and color for user-created compatible provider nodes
 * (9router PR #1829). Each node shows the initials of its own name instead of
 * a shared "OC"/"AC" badge, so several custom providers stay distinguishable
 * when their image fails to load. Color stays keyed to the node's API family.
 */
import { isString } from "./typeChecks.js";

const NODE_COLORS = {
  "anthropic-compatible": "#D97757",
  "openai-compatible": "#10A37F"
};
const DEFAULT_NODE_COLOR = "#6b7280";

function initials(name, fallbackId) {
  const source = isString(name) && name.trim() ? name.trim() : isString(fallbackId) ? fallbackId : "";
  return source.slice(0, 2).toUpperCase();
}

/**
 * @param {{ id?: string, name?: string, type?: string }} node
 * @returns {{ textIcon: string, color: string }}
 */
export function resolveProviderNodeIcon(node) {
  const type = node?.type;
  const fallback = type === "anthropic-compatible" ? "AC" : "OC";
  return {
    textIcon: initials(node?.name, node?.id) || fallback,
    color: NODE_COLORS[type] || DEFAULT_NODE_COLOR
  };
}
