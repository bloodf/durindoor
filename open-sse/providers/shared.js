import { platform, arch } from "os";

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

/** Claude Code version shared by transport and cloaked billing fingerprints. */
export const CLAUDE_CLI_VERSION = "2.1.258";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint captured from Claude Code 2.1.258.
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

// Official Antigravity IDE Desktop 2.5.5 fingerprint captured from macOS arm64.
// Keep this static even when DurinDoor runs on Linux: the provider profile is
// intentionally matching the IDE client, not the server host.
export const ANTIGRAVITY_IDE_VERSION = "2.5.5";
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
