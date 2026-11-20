import { FORMATS } from "../formats.js";
import { PROVIDERS } from "../../providers/index.js";

export const CLAUDE_SEARCH = "web_search_20250305";
export const hasClaudeSearch = body => Array.isArray(body?.tools) && body.tools.some(tool => tool?.type === CLAUDE_SEARCH);

/** Reject native search that the chosen route cannot honor before dispatch. */
export function validateSearchRoute(body, source, target, provider) {
  if (source !== FORMATS.CLAUDE || !Array.isArray(body?.tools)) return null;
  const searches = body.tools.filter(tool => /^web_search_\d{8}$/.test(tool?.type || ""));
  if (!searches.length) return null;
  if (target === FORMATS.CLAUDE && (provider === "claude" || provider === "anthropic" || provider?.startsWith("anthropic-compatible") || searches.every(tool => PROVIDERS[provider]?.quirks?.claudeSupportedToolTypes?.includes(tool.type)))) return null;
  if (provider === "codex" && target === FORMATS.OPENAI_RESPONSES && searches.every(tool => tool.type === CLAUDE_SEARCH)) {
    if (searches.some(tool => Object.keys(tool).some(key => !["type", "name"].includes(key)))) return "Codex native search cannot enforce the requested search controls.";
    return null;
  }
  return `Native Anthropic web search is not supported on the ${provider} route.`;
}
