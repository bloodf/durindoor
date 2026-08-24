import { isString } from "@/shared/utils/typeChecks.js"; /**
 * Normalize outbound tools for upstream PR #3333.
 * Claude clients lose configured built-ins shadowed by MCP tools; DeepSeek
 * models retain only the first exact-name definition because duplicates 400.
 */

const DEDUP_RULES = [
{
  // Exa MCP present → drop built-in web tools (Exa is preferred).
  triggers: ["mcp__exa__web_search_exa", "mcp__exa__web_fetch_exa"],
  strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"]
},
{
  // Tavily MCP present → drop built-in web tools.
  triggers: ["mcp__tavily__tavily_search", "mcp__tavily__tavily_extract"],
  strip: ["WebSearch", "WebFetch", "mcp__workspace__web_fetch"]
},
{
  // Browser MCP present → drop Cowork's duplicate Claude_in_Chrome connector.
  triggers: [/^mcp__browsermcp__/],
  strip: [/^mcp__Claude_in_Chrome__/]
}];


function getToolName(t) {
  return t?.name || t?.function?.name || "";
}

function matches(name, pattern) {
  if (isString(pattern)) return name === pattern;
  return pattern instanceof RegExp ? pattern.test(name) : false;
}

/** Match DeepSeek by the case-insensitive final catalog-id segment. */
function isDeepSeekModel(model) {
  if (!isString(model)) return false;
  return /^deepseek-/i.test(model.slice(model.lastIndexOf("/") + 1));
}

/**
 * Apply client- and model-specific tool deduplication from upstream PR #3333.
 *
 * @param {Array} tools Translated outbound tools.
 * @param {{ clientTool?: string | null, model?: string | null }} [options]
 * @returns {{ tools: Array, stripped: string[] }}
 */
function dedupeTools(tools, { clientTool, model } = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stripped: [] };
  const names = tools.map(getToolName);
  const toStrip = new Set();
  const toDrop = new Set();

  if (clientTool === "claude") {
    for (const rule of DEDUP_RULES) {
      const hasTrigger = names.some((n) => rule.triggers.some((p) => matches(n, p)));
      if (!hasTrigger) continue;
      for (const n of names) {
        if (rule.strip.some((p) => matches(n, p))) toStrip.add(n);
      }
    }
  }

  if (isDeepSeekModel(model)) {
    const seen = new Set();
    for (let i = 0; i < names.length; i += 1) {
      if (!names[i]) continue;
      if (seen.has(names[i])) toDrop.add(i);else
      seen.add(names[i]);
    }
  }

  if (toStrip.size === 0 && toDrop.size === 0) return { tools, stripped: [] };
  return {
    tools: tools.filter((tool, index) => !toDrop.has(index) && !toStrip.has(getToolName(tool))),
    stripped: [...toDrop].map((index) => names[index]).concat([...toStrip])
  };
}

export { dedupeTools };