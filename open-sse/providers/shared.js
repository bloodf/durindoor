import { platform, arch } from "os";
import { isString } from "../../src/shared/utils/typeChecks.js";

// === OS/Arch helpers (Stainless fingerprint) ===
/** Map a Node platform name to the value emitted by the Stainless SDK. */
export function mapStainlessOs(platformName = platform()) {
  switch (platformName) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platformName}`;
  }
}

/** Map a Node architecture name to the value emitted by the Stainless SDK. */
export function mapStainlessArch(archName = arch()) {
  switch (archName) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${archName}`;
  }
}

// Anthropic API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";

/** Pinned Claude Code release; 2.1.280 is the first one Anthropic accepts for Claude Opus 5.5. */
export const DEFAULT_CLAUDE_CLI_VERSION = "2.1.280";
const SAFE_CLI_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/**
 * Resolve the spoofed Claude Code version. `CLAUDE_CODE_CLIENT_VERSION` overrides the pin
 * so a newer CLI gate can be met without a release; values that are not a safe header token
 * are ignored.
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function resolveClaudeCliVersion(env = process.env) {
  const override = env?.CLAUDE_CODE_CLIENT_VERSION?.trim();
  return override && SAFE_CLI_VERSION.test(override) ? override : DEFAULT_CLAUDE_CLI_VERSION;
}

/** Claude Code version shared by transport and cloaked billing fingerprints (read once at load). */
export const CLAUDE_CLI_VERSION = resolveClaudeCliVersion();

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint captured from Claude Code 2.1.258. The version
// (User-Agent + billing cc_version) is bumped to 2.1.280, the first release
// that ships Claude Opus 5.5; Anthropic rejects Opus 5.5 from older CLI
// versions. Every beta flag below is still present in the 2.1.280 bundle.
// Static stable values (UA, beta flags, package/runtime versions, runtime,
// language, retry, timeout, API version, dangerous browser header, x-app) are
// pinned to the captured wire literal. OS and architecture use the live
// host-derived Stainless mappers — the 2.1.258 capture ran on Linux x64, so
// other hosts will report different values while every other field stays
// exact. The optional helper-method header from older captures is omitted
// because the 2.1.258 request did not include it.
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24,fallback-credit-2026-06-01",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
  "X-App": "cli",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v26.3.0",
  "X-Stainless-Package-Version": "0.112.1",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

// Anthropic beta flags for anthropic-compatible-* nodes fronting Anthropic
// (port of decolua/9router#3797). Derived from the fork's pinned Claude Code
// fingerprint above (CLAUDE_CLI_SPOOF_HEADERS); effort-2025-11-24 is a
// heavy-agent flag and is only sent for opus/sonnet model ids — cheaper models
// don't need it. `oauth-2025-04-20` is intentionally excluded here: it is an
// auth-mode flag appended by the claude usage path, not a request capability.
const ANTHROPIC_BETA_BASE = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
  "fallback-credit-2026-06-01"
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["effort-2025-11-24"];

/**
 * Select the Anthropic-Beta header value for a model id.
 * Heavy-agent beta flags are gated to opus/sonnet — cheaper models don't need them.
 */
export function selectAnthropicBeta(model = "") {
  const flags = [...ANTHROPIC_BETA_BASE];
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  return flags.join(",");
}

/**
 * Client-sent betas that are forwarded per request. Claude Code 2.1.278+ sends
 * `dangerous-tool-use-2026-09-03` with a `safeguards` body field; Fable 5.1 and
 * Opus 5.5 need the thinking betas for `thinking.block_binding` / `thinking.display`.
 * Dropping them turns those body fields into 400s.
 */
export const FORWARDABLE_CLIENT_BETAS = new Set([
  "thinking-binding-controls-2026-08-01",
  "thinking-display-updates-2026-08-18",
  "dangerous-tool-use-2026-09-03"
]);

/**
 * Add the allowlisted betas the calling client sent to the outbound Anthropic-Beta header.
 * Other client betas are ignored. Mutates and returns `headers`.
 * @param {Record<string, string>} headers outbound headers
 * @param {Record<string, string>|null|undefined} clientHeaders inbound request headers
 */
export function mergeForwardableClientBetas(headers, clientHeaders) {
  const raw = clientHeaders?.["anthropic-beta"] ?? clientHeaders?.["Anthropic-Beta"];
  if (!isString(raw)) return headers;
  const wanted = raw.split(",").map((f) => f.trim()).filter((f) => FORWARDABLE_CLIENT_BETAS.has(f));
  if (wanted.length === 0) return headers;
  const key = headers["anthropic-beta"] !== undefined ? "anthropic-beta" : "Anthropic-Beta";
  const flags = new Set((headers[key] || "").split(",").map((f) => f.trim()).filter(Boolean));
  for (const flag of wanted) flags.add(flag);
  headers[key] = Array.from(flags).join(",");
  return headers;
}

// Kimi Code single-source endpoints and documented membership display names.
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";
export const KIMI_CODING_OPENAI_URL = "https://api.kimi.com/coding/v1/chat/completions";
export const KIMI_CODING_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
export const KIMI_CODING_MODELS_URL = "https://api.kimi.com/coding/v1/models";
export const KIMI_PLATFORM_CHAT_URL = "https://api.moonshot.ai/v1/chat/completions";
export const KIMI_PLANS = Object.freeze({
  Andante: "Andante",
  LEVEL_BASIC: "Moderato",
  LEVEL_INTERMEDIATE: "Allegretto",
  LEVEL_ADVANCED: "Allegro",
  LEVEL_STANDARD: "Vivace",
});

// Default base for dynamic compat providers (openai-compatible-* / anthropic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/**
 * True only for the canonical OpenCode Zen API root. This exact base-URL check
 * enables Muse Responses routing for custom OpenAI-compatible nodes; it does
 * not infer support from model text and deliberately does not apply to Luna.
 */
export function isOpenCodeZenBaseUrl(baseUrl) {
  return isString(baseUrl) &&
  baseUrl.trim().replace(/\/+$/, "") === OPENCODE_ZEN_BASE_URL;
}

// Official Antigravity IDE Desktop 2.11.0 fingerprint captured from macOS arm64.
// Keep this static even when DurinDoor runs on Linux: the provider profile is
// intentionally matching the IDE client, not the server host.
// DurinDoor keeps the PROD cloudcode-pa host (upstream uses the daily host).
export const ANTIGRAVITY_IDE_VERSION = "2.11.0";
export const ANTIGRAVITY_IDE_BASE_URL = "https://cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

// Antigravity OAuth client credentials (public CLI client — duplicated in usage.js + src/lib/oauth)
// Set via env vars — see SECRETS_AND_CONFIG.md
const ANTIGRAVITY_OAUTH_CLIENT_ID = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "";
const ANTIGRAVITY_OAUTH_CLIENT_SECRET = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || "";

export const ANTIGRAVITY_OAUTH_CLIENT = {
  clientId: ANTIGRAVITY_OAUTH_CLIENT_ID,
  clientSecret: ANTIGRAVITY_OAUTH_CLIENT_SECRET
};

// Gemini (Google) OAuth client credentials (public CLI client — shared by gemini, gemini-cli, src/lib/oauth)
// Set via env vars — see SECRETS_AND_CONFIG.md
const GOOGLE_OAUTH_CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || "";
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET || "";

export const GOOGLE_OAUTH_CLIENT = {
  clientId: GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: GOOGLE_OAUTH_CLIENT_SECRET
};
