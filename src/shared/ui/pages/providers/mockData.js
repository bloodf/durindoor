/** Story-only provider states mirror the dashboard status filter contract. */
export const providerStatusOptions = [
  { value: "all", label: "All" },
  { value: "active", label: "Active only" },
  { value: "deactivated", label: "Deactivated" },
  { value: "not-configured", label: "Not configured" },
];

export const oauthProviders = [
  {
    id: "claude-code",
    logoProvider: "cc",
    name: "Claude Code",
    status: "active",
    detail: "2 Connected",
    enabled: true,
  },
  {
    id: "openai-codex",
    logoProvider: "cx",
    name: "OpenAI Codex",
    status: "active",
    detail: "1 Connected",
    enabled: true,
  },
  {
    id: "cursor",
    name: "Cursor IDE",
    status: "active",
    detail: "1 Connected",
    enabled: true,
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    status: "active",
    detail: "1 Connected",
    enabled: true,
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    status: "deactivated",
    detail: "Deactivated",
    enabled: false,
  },
];

export const apiKeyProviders = [
  {
    id: "kimi-coding",
    logoProvider: "kimi-coding-apikey",
    name: "Kimi Coding API Key",
    status: "active",
    detail: "1 Connected",
    enabled: true,
  },
  {
    id: "minimax-coding",
    logoProvider: "minimax",
    name: "Minimax Coding",
    status: "deactivated",
    detail: "Deactivated",
    enabled: false,
  },
  {
    id: "ollama-local",
    name: "Ollama Local",
    status: "not-configured",
    detail: "Not configured",
    enabled: false,
  },
];

export const freeTierProviders = [
  { id: "auggie", name: "Augment Auggie CLI" },
  { id: "chipotle", name: "Chipotle Pepper" },
  { id: "duckduckgo-web", name: "DuckDuckGo AI Chat" },
  { id: "mimo-free", name: "MiMo Code Free" },
].map((provider) => ({
  ...provider,
  status: "not-configured",
  detail: "Not configured",
  enabled: false,
  disabled: true,
}));
