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

/**
 * Pinned Claude Code release (latest on npm when last bumped). It must stay at or above
 * 2.1.280, the first release Anthropic accepts for Claude Opus 5.5.
 */
export const DEFAULT_CLAUDE_CLI_VERSION = "2.1.312";
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

/**
 * First-party Anthropic-Beta from a live Claude Code 2.1.312 API-key
 * `claude -p --model sonnet` capture with
 * `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1`. Those three extras that only
 * appear under the first-party host check —
 * `prompt-caching-scope-2026-01-05` (also already on main's third-party pin),
 * `thinking-binding-controls-2026-08-01`, and `cache-diagnosis-2026-04-07` —
 * must not ride third-party / custom-base-URL paths. Used only by the
 * `claude` provider and the Claude OAuth usage/reset helpers.
 * `fallback-credit-2026-06-01` is intentionally absent: 2.1.312 only adds it
 * after a fallback-credit lane is armed (post-refusal) and drops it again on
 * a credit_beta_header 400.
 */
export const CLAUDE_FIRST_PARTY_ANTHROPIC_BETA =
  "claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,thinking-binding-controls-2026-08-01,cache-diagnosis-2026-04-07";

/**
 * Third-party / custom-base-URL Anthropic-Beta: the pre-PR string from
 * origin/main, byte-for-byte. Used by agentrouter and by selectAnthropicBeta
 * for anthropic-compatible-* nodes. First-party-gated flags
 * (`thinking-binding-controls-2026-08-01`, `cache-diagnosis-2026-04-07`) stay
 * off this set. `prompt-caching-scope-2026-01-05` was already on main, so
 * third-party paths are unchanged versus main for that flag.
 */
export const CLAUDE_THIRD_PARTY_ANTHROPIC_BETA =
  "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24,fallback-credit-2026-06-01";

// Full Claude CLI fingerprint for the first-party `claude` OAuth provider.
// UA / Stainless / x-app come from the 2.1.312 capture; Anthropic-Beta is the
// first-party set above. OAuth-only extras (`oauth-2025-04-20`,
// `extended-cache-ttl-2025-04-11`) are added by buildClaudeOAuthAnthropicBeta.
// OS and architecture use the live host-derived Stainless mappers. The
// optional helper-method header is omitted because the capture did not
// include it.
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": CLAUDE_FIRST_PARTY_ANTHROPIC_BETA,
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
  "X-App": "cli",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v26.12.1",
  "X-Stainless-Package-Version": "0.128.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

/**
 * Same CLI fingerprint as CLAUDE_CLI_SPOOF_HEADERS, but with the third-party
 * Anthropic-Beta string. For agentrouter and any other non-first-party host
 * that still wants the Claude Code UA/Stainless cloak without first-party-
 * gated betas.
 */
export const CLAUDE_COMPAT_SPOOF_HEADERS = {
  ...CLAUDE_CLI_SPOOF_HEADERS,
  "Anthropic-Beta": CLAUDE_THIRD_PARTY_ANTHROPIC_BETA
};

// Anthropic beta flags for anthropic-compatible-* nodes fronting Anthropic
// (port of decolua/9router#3797). Kept on the pre-PR third-party set so custom
// gateways do not receive first-party-gated flags. effort-2025-11-24 is a
// heavy-agent flag and is only sent for opus/sonnet model ids.
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
 * Select the Anthropic-Beta header value for a model id on anthropic-compatible-*
 * nodes. Uses the third-party (pre-PR) flag set; heavy-agent betas are gated to
 * opus/sonnet.
 */
export function selectAnthropicBeta(model = "") {
  const flags = [...ANTHROPIC_BETA_BASE];
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  return flags.join(",");
}

/**
 * OAuth-mode Anthropic-Beta for Claude usage/reset helpers.
 * Starts from the first-party pin, inserts `extended-cache-ttl-2025-04-11`
 * before `cache-diagnosis-2026-04-07` (OAuth wire order from the 2.1.312
 * first-party OAuth capture), then appends `oauth-2025-04-20`.
 * @param {string} [baseBeta]
 * @returns {string}
 */
export function buildClaudeOAuthAnthropicBeta(baseBeta = CLAUDE_FIRST_PARTY_ANTHROPIC_BETA) {
  const flags = String(baseBeta || "").split(",").map((f) => f.trim()).filter(Boolean);
  if (!flags.includes("extended-cache-ttl-2025-04-11")) {
    const i = flags.indexOf("cache-diagnosis-2026-04-07");
    if (i >= 0) flags.splice(i, 0, "extended-cache-ttl-2025-04-11");
    else flags.push("extended-cache-ttl-2025-04-11");
  }
  if (!flags.includes("oauth-2025-04-20")) flags.push("oauth-2025-04-20");
  return flags.join(",");
}

/**
 * Client-sent betas that are forwarded per request. Claude Code 2.1.278+ sends
 * `dangerous-tool-use-2026-09-03` with a `safeguards` body field; Fable 5.1 and
 * Opus 5.5 need the thinking betas for `thinking.block_binding` / `thinking.display`.
 * Claude Code 2.1.284 also sends timing and inline-tools per turn; inline-tools
 * gates message-level `tool_addition` blocks. Dropping these causes HTTP 400s.
 */
export const FORWARDABLE_CLIENT_BETAS = new Set([
  "thinking-binding-controls-2026-08-01",
  "thinking-display-updates-2026-08-18",
  // Claude Code sends this paired with dangerous-tool-use-2026-09-03 while
  // auto mode is active; without it the upstream never sees the full
  // auto-mode negotiation (OmniRoute #14694).
  "dangerous-tool-use-2026-09-03",
  "afk-mode-2026-01-31",
  "timing-2026-09-09",
  "inline-tools-2026-09-15"
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
