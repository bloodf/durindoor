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

export const FEATURES = [
  {
    icon: "plug",
    title: "One local endpoint",
    body: "Configure tools once against http://localhost:20128/v1 instead of wiring each app to a different provider.",
    wide: true,
  },
  {
    icon: "key",
    title: "Reusable provider connections",
    body: "Add an OAuth login, API key, cookie, or compatible endpoint once. Every tool shares it.",
    wide: true,
  },
  {
    icon: "layers",
    title: "Account & combo fallback",
    body: "Chain connections for resilience, or stack models behind one stable name that retries the next option.",
  },
  {
    icon: "swap",
    title: "Format translation",
    body: "Send OpenAI-shaped requests; DurinDoor speaks Claude, Gemini, Kiro, Cursor, Ollama, Vertex and more upstream.",
  },
  {
    icon: "chart",
    title: "Usage visibility",
    body: "Provider, model, tokens, cost estimate, latency and fallback outcome for every request.",
  },
  {
    icon: "shield",
    title: "Self-hosted state",
    body: "Storage, credentials and logs live in your DATA_DIR. You decide where it runs and who can reach it.",
  },
  {
    icon: "spark",
    title: "Token saver",
    body: "Opt-in prompt compression before upstream dispatch. Fail-open by design, so requests never break.",
  },
  {
    icon: "hub",
    title: "MCP gateway",
    body: "Expose multiple MCP servers behind managed keys and routes from the same dashboard.",
  },
  {
    icon: "gauge",
    title: "Quota tracking",
    body: "Provider limits and reset windows side by side, so you know which account still has room.",
  },
  {
    icon: "wand",
    title: "CLI tool auto-config",
    body: "Point Claude Code, Codex, Cursor, Cline and friends at DurinDoor without hand-editing config files.",
  },
];
