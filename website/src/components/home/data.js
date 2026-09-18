// Static content for the homepage sections.

export const GITHUB_URL = "https://github.com/bloodf/durindoor";
export const NPM_URL = "https://www.npmjs.com/package/durindoor";

const logo = (file) => `/home/providers/${file}.png`;

export const CLIENTS = [
  { name: "Claude Code", logo: logo("claude") },
  { name: "Codex", logo: logo("codex") },
  { name: "Cursor", logo: logo("cursor") },
  { name: "Cline", logo: logo("cline") },
];

export const FLOW_PROVIDERS = [
  { name: "OpenAI", logo: logo("openai") },
  { name: "Anthropic", logo: logo("anthropic") },
  { name: "Gemini", logo: logo("gemini") },
  { name: "OpenRouter", logo: logo("openrouter") },
  { name: "DeepSeek", logo: logo("deepseek") },
  { name: "Ollama", logo: logo("ollama") },
];

export const TOOLS = [
  { name: "Claude Code", logo: logo("claude"), href: "/docs/integrations/claude-code" },
  { name: "OpenAI Codex", logo: logo("codex"), href: "/docs/integrations/codex" },
  { name: "Cursor", logo: logo("cursor"), href: "/docs/integrations/cursor" },
  { name: "Cline", logo: logo("cline"), href: "/docs/integrations/cline" },
  { name: "Kilo Code", logo: logo("kilocode") },
  { name: "Droid", logo: logo("droid") },
  { name: "OpenCode", logo: logo("opencode") },
  { name: "GitHub Copilot", logo: logo("copilot") },
  { name: "Hermes", logo: logo("hermes") },
  { name: "Continue", logo: logo("continue"), href: "/docs/integrations/continue" },
  { name: "Roo Code", logo: logo("roo"), href: "/docs/integrations/roo" },
  { name: "Gemini CLI", logo: logo("gemini-cli") },
  { name: "Antigravity", logo: logo("antigravity") },
  { name: "Kiro", logo: logo("kiro") },
  { name: "Amp", logo: logo("amp") },
  { name: "OpenClaw", logo: logo("openclaw") },
];

export const PROVIDERS = [
  "openai", "anthropic", "gemini", "openrouter", "groq", "deepseek", "mistral", "ollama",
  "xai", "qwen", "kimi", "glm", "minimax", "cohere", "together", "fireworks",
  "cerebras", "nvidia", "perplexity", "huggingface", "vertex", "azure",
].map((id) => ({ id, logo: logo(id) }));

export const RESOLUTIONS = [
  {
    kind: "Provider model",
    input: "openai/gpt-4.1",
    lines: [
      { tone: "dim", text: "resolve   provider model" },
      { tone: "info", text: "provider  openai" },
      { tone: "info", text: "upstream  gpt-4.1" },
      { tone: "ok", text: "200 OK    stream · 412 ms" },
    ],
  },
  {
    kind: "Provider alias",
    input: "cc/claude-sonnet",
    lines: [
      { tone: "dim", text: "resolve   registry alias" },
      { tone: "info", text: "alias     cc → claude" },
      { tone: "info", text: "translate openai → claude messages" },
      { tone: "ok", text: "200 OK    stream · 538 ms" },
    ],
  },
  {
    kind: "Model alias",
    input: "daily-coder",
    lines: [
      { tone: "dim", text: "resolve   user alias" },
      { tone: "info", text: "maps to   openrouter/qwen3-coder" },
      { tone: "info", text: "account   personal · healthy" },
      { tone: "ok", text: "200 OK    json · 301 ms" },
    ],
  },
  {
    kind: "Combo",
    input: "coding-default",
    lines: [
      { tone: "dim", text: "resolve   combo · 3 members" },
      { tone: "err", text: "try 1     cc/claude-sonnet → 429 rate limited" },
      { tone: "warn", text: "fallback  next member" },
      { tone: "ok", text: "try 2     gemini/gemini-2.5-pro → 200 OK" },
    ],
  },
];

// Leftover surfaces not claimed in flow, quota, savers, or tools.
// href values follow master plan §4; stubs are fine until the content tasks land.
export const FEATURES = [
  {
    icon: "hub",
    title: "MCP gateway",
    body: "One DurinDoor endpoint in front of several MCP servers, with gateway keys that map to specific instances.",
    href: "/docs/features/mcp-gateway",
  },
  {
    icon: "chat",
    title: "Realtime",
    body: "GET /v1/realtime upgrades to a text WebSocket in the OpenAI Realtime shape. Audio is not supported.",
    href: "/docs/features/realtime",
  },
  {
    icon: "route",
    title: "Proxy timeline",
    body: "Optional redacted hop log for proxy calls. Off by default. Stored next to the main database.",
    href: "/docs/features/proxy-timeline",
  },
  {
    icon: "tunnel",
    title: "Tunnels",
    body: "Reach the gateway from another network over HTTPS. Cloudflare and Tailscale are the built-in tunnel providers.",
    href: "/docs/deployment",
  },
];
