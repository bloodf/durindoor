// Static content for the homepage sections.

export const GITHUB_URL = "https://github.com/bloodf/durindoor";
export const NPM_URL = "https://www.npmjs.com/package/durindoor";
export const DOCS_URL = "https://github.com/bloodf/durindoor/tree/main/docs";

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
  { name: "Claude Code", logo: logo("claude") },
  { name: "OpenAI Codex", logo: logo("codex") },
  { name: "Cursor", logo: logo("cursor") },
  { name: "Cline", logo: logo("cline") },
  { name: "Kilo Code", logo: logo("kilocode") },
  { name: "Droid", logo: logo("droid") },
  { name: "OpenCode", logo: logo("opencode") },
  { name: "GitHub Copilot", logo: logo("copilot") },
  { name: "Hermes", logo: logo("hermes") },
  { name: "Continue", logo: logo("continue") },
  { name: "Roo Code", logo: logo("roo") },
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

// Bento order: each row of the 4-column grid adds up to four cells.
// Claims map to README.md, docs/ARCHITECTURE.md, docs/providers/cheap.md and docs/guides/usage.md.
export const FEATURES = [
  {
    icon: "layers",
    title: "Combos",
    body: "Stack models behind one stable name. A failed member falls through to the next, so tools never change their config.",
    wide: true,
  },
  {
    icon: "swap",
    title: "Format translator",
    body: "Send OpenAI-shaped requests; Claude, Gemini, Kiro, Cursor, Ollama and Vertex formats are handled upstream.",
  },
  {
    icon: "users",
    title: "Multi-account",
    body: "Several connections per provider. Locked or expired accounts are skipped and OAuth tokens refresh.",
  },
  {
    icon: "tunnel",
    title: "Tunnels",
    body: "Reach your gateway from another network over HTTPS. Keep dashboard auth on, turn it off when unused.",
  },
  {
    icon: "route",
    title: "Proxy pools",
    body: "Route upstream traffic through configured proxies for regional routing or egress control.",
  },
  {
    icon: "mask",
    title: "MITM bridge",
    body: "Optional local interception for supported IDE traffic, behind explicit setup and trust changes.",
  },
  {
    icon: "hub",
    title: "MCP gateway",
    body: "Expose multiple MCP servers behind managed keys and routes from the same dashboard.",
  },
  {
    icon: "dash",
    title: "One dashboard",
    body: "Providers, API keys, combos, usage, request logs, endpoint setup, CLI tools, tunnels, MITM and MCP in one browser UI.",
    wide: true,
  },
  {
    icon: "wand",
    title: "CLI tool setup",
    body: "Copy ready integration settings for Claude Code, Codex, Cursor, Cline and more.",
  },
  {
    icon: "shield",
    title: "Self-hosted state",
    body: "Storage, credentials and logs live in your DATA_DIR. You decide who can reach it.",
  },
];
