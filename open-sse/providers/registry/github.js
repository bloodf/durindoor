import {
  GITHUB_COUNT_TOKENS_PREFLIGHT_RATIO,
  GITHUB_COUNT_TOKENS_TIMEOUT_MS,
} from "../../config/github.js";

export default {
  id: "github",
  priority: 40,
  alias: "gh",
  uiAlias: "gh",
  display: {
    name: "GitHub Copilot",
    icon: "code",
    color: "#333333",
    website: "https://github.com/features/copilot",
    notice: {
      signupUrl: "https://github.com/features/copilot",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.githubcopilot.com/chat/completions",
    responsesUrl: "https://api.githubcopilot.com/responses",
    messagesUrl: "https://api.githubcopilot.com/v1/messages",
    countTokensUrl: "https://api.githubcopilot.com/v1/messages/count_tokens",
    countTokensPreflightRatio: GITHUB_COUNT_TOKENS_PREFLIGHT_RATIO,
    countTokensTimeoutMs: GITHUB_COUNT_TOKENS_TIMEOUT_MS,
    headers: {
      "copilot-integration-id": "vscode-chat",
      "editor-version": "vscode/1.110.0",
      "editor-plugin-version": "copilot-chat/0.38.0",
      "user-agent": "GitHubCopilotChat/0.38.0",
      "openai-intent": "conversation-panel",
      "x-github-api-version": "2025-04-01",
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    copilot: {
      vscodeVersion: "1.110.0",
      chatVersion: "0.38.0",
      userAgent: "GitHubCopilotChat/0.38.0",
      apiVersion: "2025-04-01",
    },
    // Chat accepts the Responses `prompt_cache_key` extension after lowering.
    quirks: { preservePromptCacheKey: true },
    usage: {
      url: "https://api.github.com/copilot_internal/user",
    },
  },
  // Note: routing to Copilot's Anthropic-native /v1/messages shim (see
  // executors/github.js) is decided by model-NAME pattern at request time, not by
  // a static targetFormat field here — Copilot's live model catalog (see
  // services/copilotModels.js) regularly exposes claude-* models this static list
  // hasn't caught up with yet, and static per-entry targetFormat would silently
  // miss those while also double-translating requests for models that ARE listed
  // here (chatCore pre-translates to Claude shape, then the executor would
  // translate again). Keep plain entries.
  models: [
    // GoldenEye is GitHub's auto-routing model available on ALL tiers including free.
    // Listed first so it is the default for connection tests and model selector.
    // Free-tier users MUST use this model — premium models (gpt-5.x, claude-opus, etc.)
    // return 403 on free accounts. Paid users can select any model below.
    { id: "goldeneye-free-auto", name: "GoldenEye (Auto)" },
    // Additions from the upstream 2026-10-19 catalog refresh (GitHub supported-models docs).
    // Retired ids stay listed until the owner decides to drop them; live discovery is authoritative.
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
    { id: "gpt-6-sol", name: "GPT-6 Sol" },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
    { id: "claude-fable-5.1", name: "Claude Fable 5.1" },
    { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4.8-fast", name: "Claude Opus 4.8 (Fast)" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "gemini-4-argon", name: "Gemini 4 Argon" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "mai-code-1.1-flash", name: "MAI-Code-1.1-Flash" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
    { id: "oswe-vscode-prime", name: "Raptor Mini" },
    { id: "text-embedding-3-small", name: "Text Embedding 3 Small (GitHub)", kind: "embedding" },
    { id: "text-embedding-ada-002", name: "Text Embedding Ada 002 (GitHub)", kind: "embedding" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
  ],
  serviceKinds: ["llm","embedding"],
  embeddingConfig: { baseUrl: "https://api.githubcopilot.com/embeddings", authType: "apikey", authHeader: "bearer" },
  oauth: {
    clientId: "Iv1.b507a08c87ecfe98",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: "read:user",
    apiVersion: "2022-11-28",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    userAgent: "GitHubCopilotChat/0.26.7",
    editorVersion: "vscode/1.85.0",
    editorPluginVersion: "copilot-chat/0.26.7",
  },
  features: {
    usage: true,
  },
};
