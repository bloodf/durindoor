/**
 * Detect CLI tool identity from request headers/body.
 * Used to determine if a request can be passed through losslessly.
 */

// Map of CLI tool identifiers to provider IDs they are "native" to
const NATIVE_PAIRS = {
  "claude": ["claude", "anthropic"],
  "gemini-cli": ["gemini-cli"],
  "antigravity": ["antigravity"],
  "codex": ["codex"],
};

/**
 * Detect which CLI tool is making the request.
 * Returns one of: "claude" | "gemini-cli" | "antigravity" | "codex" | null
 * @param {object} headers - Lowercase header key/value object
 * @param {object} body    - Parsed request body
 */
export function detectClientTool(headers = {}, body = {}) {
  const ua = (headers["user-agent"] || "").toLowerCase();
  const xApp = (headers["x-app"] || "").toLowerCase();
  const openaiIntent = (headers["openai-intent"] || "").toLowerCase();
  const initiator = (headers["x-initiator"] || headers["X-Initiator"] || "").toLowerCase();

  // Antigravity: detected via body field (not header)
  if (body.userAgent === "antigravity") return "antigravity";

  // GitHub Copilot / OAI compatible extension using Copilot chat headers
  if (ua.includes("githubcopilotchat") || openaiIntent === "conversation-panel" || initiator === "user") {
    return "github-copilot";
  }

  // Claude Code / Claude CLI
  if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") return "claude";

  // Gemini CLI
  if (ua.includes("gemini-cli")) return "gemini-cli";

  // Codex CLI (codex-cli / codex_cli_rs / codex_exec)
  if (ua.includes("codex-cli") || ua.includes("codex_cli_rs") || ua.includes("codex_exec")) return "codex";

  // DeepSeek TUI
  if (ua.includes("deepseek-tui")) return "deepseek-tui";

  return null;
}

/**
 * Check if this CLI tool + provider pair should be passed through losslessly.
 * @param {string|null} clientTool - Result of detectClientTool()
 * @param {string} provider        - Provider ID (e.g. "claude", "gemini-cli")
 */
export function isNativePassthrough(clientTool, provider) {
  if (!clientTool) return false;
  const nativeProviders = NATIVE_PAIRS[clientTool];
  if (!nativeProviders) return false;
  // Support anthropic-compatible-* variants
  const normalizedProvider = provider.startsWith("anthropic-compatible")
    ? "anthropic"
    : provider;
  return nativeProviders.includes(normalizedProvider);
}

/**
 * Codex-originated request detection (OmniRoute #6820, issue #3697). Matches
 * upstream `isCodexOriginatedHeaders`: a header value counts when it STARTS
 * with `codex` (case-insensitive), so `codex_exec`, `codex_cli_rs`,
 * `codex-cli`, `codex/1.2.3` all match — but a substring elsewhere does NOT
 * (no spoof-like `my-codex-proxy`). Either `originator` or `user-agent` is
 * sufficient.
 *
 * Accepts a WHATWG `Headers` object or a plain record (lowercase keys).
 * @param {Headers|Record<string,string>|null|undefined} headers
 * @returns {boolean}
 */
export function isCodexOriginatedHeaders(headers) {
  if (!headers) return false;
  let originator = "";
  let ua = "";
  const read = (value) => (typeof value === "string" ? value.toLowerCase() : "");
  if (typeof headers.get === "function") {
    // WHATWG Headers: .get is case-insensitive per spec.
    originator = read(headers.get("originator"));
    ua = read(headers.get("user-agent"));
  } else {
    // Plain record: keys may be any case (`User-Agent`, `Originator`, ...).
    // Only string values count — a spoof object with a crafted toString must
    // not coerce into a match.
    for (const [key, value] of Object.entries(headers)) {
      const name = key.toLowerCase();
      if (name === "originator") originator = read(value);
      else if (name === "user-agent") ua = read(value);
    }
  }
  return originator.startsWith("codex") || ua.startsWith("codex");
}
