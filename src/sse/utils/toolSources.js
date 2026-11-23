import { isString } from "../../shared/utils/typeChecks.js";

/** Summarize tool names only when diagnostics are enabled. Names are sanitized for logs. */
export function summarizeToolSources(tools, enabled) {
  if (enabled !== true || !Array.isArray(tools) || tools.length === 0) return null;
  const names = tools.map((tool) => {
    const name = tool?.name || tool?.function?.name || tool?.type;
    return isString(name) ? name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) : "unknown";
  });
  const counts = new Map();
  for (const name of names) {
    const source = name.startsWith("mcp__") ? `mcp:${name.split("__")[1] || "unknown"}` :
      /^(web_search|web_fetch)/.test(name) ? "hosted:web" :
      /^(computer_|str_replace_)/.test(name) ? "hosted:computer" : "client";
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  const sources = [...counts].slice(0, 80).map(([source, count]) => `${source}=${count}`).join(", ");
  const suffix = names.length > 80 ? `, ... +${names.length - 80} more` : "";
  return `${names.length} tools | sources: ${sources} | names: ${names.slice(0, 80).join(", ")}${suffix}`;
}
