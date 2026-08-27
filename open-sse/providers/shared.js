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
export const CLAUDE_CLI_VERSION = "2.1.220";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint — required by providers that gate on client identity (e.g. agentrouter)
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.94.0",
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
