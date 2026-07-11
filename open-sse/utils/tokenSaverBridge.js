import { detectFormat } from "../services/provider.js";
import { FORMATS } from "../translator/formats.js";
import { createSyntheticResponse } from "./bypassResponse.js";

const DEFAULT_PONYTAIL_HELP =
  "Ponytail — lazy-senior persona for minimal code.\n" +
  "\n" +
  "3 intensity levels:\n" +
  "  lite   — name the lazier alternative in one line; user picks\n" +
  "  full   — ladder enforced; stdlib and native first\n" +
  "  ultra  — YAGNI extremist; ship the one-liner, challenge the rest\n" +
  "\n" +
  "7-rung ladder (stop at the first rung that holds):\n" +
  "  1. Does this need to exist at all? (YAGNI)\n" +
  "  2. Does the codebase already solve it? Reuse patterns.\n" +
  "  3. Stdlib does it? Use it.\n" +
  "  4. Native platform feature covers it? Use it (CSS over JS, DB over app).\n" +
  "  5. Already-installed dependency solves it? Use it.\n" +
  "  6. Can it be one line? One line.\n" +
  "  7. Only then: the minimum code that works.\n" +
  "\n" +
  "Rules: no unrequested abstractions. No boilerplate \"for later\". " +
  "Deletion over addition. Boring over clever. Shortest working diff wins.\n" +
  "\n" +
  "Output: code first. Then at most three short lines: what was skipped, " +
  "when to add it. Pattern: `[code] -> skipped: [X], add when [Y].`\n" +
  "\n" +
  "How to enable: toggle Ponytail in Token Saver settings.\n" +
  "\n" +
  "Commands:\n" +
  "  /ponytail-gain  — show this API key's lifetime usage\n" +
  "  /ponytail-help  — show this help text";

function formatGainStats(stats) {
  if (!stats) {
    return "Ponytail gain: usage stats are available in the dashboard.";
  }

  const nf = new Intl.NumberFormat("en-US");
  const scope = typeof stats.scope === "string" && stats.scope ? ` (${stats.scope})` : "";
  const lines = [`Ponytail gain — lifetime${scope}`];
  lines.push("  requests: " + nf.format(stats.totalRequests || 0));
  if (Number.isFinite(Number(stats.totalTokens))) {
    lines.push("  total tokens: " + nf.format(Number(stats.totalTokens) || 0));
  } else {
    lines.push("  prompt tokens:     " + nf.format(stats.totalPromptTokens || 0));
    lines.push("  completion tokens: " + nf.format(stats.totalCompletionTokens || 0));
    lines.push("  cached tokens:      " + nf.format(stats.totalCachedTokens || 0));
  }
  lines.push("  est. cost: $" + (Number(stats.totalCost) || 0).toFixed(2));

  if (stats.byProvider && typeof stats.byProvider === "object") {
    const entries = Object.entries(stats.byProvider);
    if (entries.length > 0) {
      let topProvider = entries[0][0];
      let topCount = entries[0][1].requests || 0;
      let totalCount = topCount;
      for (let i = 1; i < entries.length; i++) {
        const count = entries[i][1].requests || 0;
        totalCount += count;
        if (count > topCount) {
          topProvider = entries[i][0];
          topCount = count;
        }
      }
      const pct = totalCount > 0 ? ((topCount / totalCount) * 100).toFixed(0) : "0";
      lines.push("  top provider: " + topProvider + " (" + pct + "% of requests)");
    }
  }

  return lines.join("\n");
}

function textFromBlocks(content, allowedTypes) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content) || content.length === 0) return null;

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || !allowedTypes.has(block.type)) return null;
    if (typeof block.text !== "string") return null;
    parts.push(block.text);
  }
  return parts.join(" ").trim();
}

function textFromChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  return textFromBlocks(last.content, new Set(["text", "input_text"]));
}

function textFromResponsesInput(input) {
  if (typeof input === "string") return input.trim();
  const items = Array.isArray(input) ? input : [input];
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  if (typeof last === "string") return last.trim();
  if (!last || typeof last !== "object") return null;
  if (last.type !== undefined && last.type !== "message") return null;
  if (last.role !== "user") return null;
  return textFromBlocks(last.content, new Set(["input_text", "text"]));
}

function textFromGeminiContents(contents) {
  if (!Array.isArray(contents) || contents.length === 0) return null;
  const last = contents[contents.length - 1];
  if (!last || last.role !== "user" || !Array.isArray(last.parts) || last.parts.length === 0) {
    return null;
  }

  const parts = [];
  for (const part of last.parts) {
    if (!part || typeof part !== "object" || typeof part.text !== "string") return null;
    if (Object.keys(part).some((key) => key !== "text")) return null;
    parts.push(part.text);
  }
  return parts.join(" ").trim();
}

/**
 * Parse an exact Ponytail command from the active final user turn.
 * Text-only Chat Completions, Responses `input_text`, and Gemini `parts[].text`
 * are supported. Mixed media/tool blocks and older turns deliberately fail open
 * to the upstream request path.
 */
export function extractPonytailCommand(body = {}) {
  const text = Array.isArray(body.messages)
    ? textFromChatMessages(body.messages)
    : body.input !== undefined
      ? textFromResponsesInput(body.input)
      : textFromGeminiContents(body.contents || body.request?.contents);

  if (!text) return null;
  const match = text.match(/^\/ponytail(?:-|[\t ]+)(gain|help)$/i);
  return match ? match[1].toLowerCase() : null;
}

/** Resolve the client's requested response mode without changing protocol defaults. */
export function resolvePonytailStream(body = {}, sourceFormat, acceptHeader = "") {
  if (body.stream === true) return true;
  if (body.stream === false) return false;
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersSSE && !clientPrefersJson) return true;
  if (clientPrefersJson && !clientPrefersSSE) return false;
  return !(sourceFormat === FORMATS.OPENAI_RESPONSES
    || sourceFormat === FORMATS.OPENAI_RESPONSE
    || sourceFormat === FORMATS.CODEX);
}

/**
 * Returns null if no command matched — let request pass through.
 *
 * `fetchStats` is lazy: only invoked when the matched command is
 * `/ponytail-gain`. This keeps the hot path cheap for normal requests.
 */
export async function handlePonytailCommands(body, model, { fetchStats, helpText, sourceFormatOverride, streamOverride } = {}) {
  const command = extractPonytailCommand(body);
  if (!command) return null;

  let text;
  if (command === "gain") {
    let stats = null;
    if (typeof fetchStats === "function") {
      try { stats = await fetchStats(); } catch { /* stats are best-effort */ }
    }
    text = formatGainStats(stats);
  } else {
    text = helpText || DEFAULT_PONYTAIL_HELP;
  }

  const sourceFormat = sourceFormatOverride || detectFormat(body);
  const stream = streamOverride ?? resolvePonytailStream(body, sourceFormat);

  return createSyntheticResponse({ sourceFormat, model, text, stream });
}

export { DEFAULT_PONYTAIL_HELP };
