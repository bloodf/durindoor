// Copy and figures for the story sections. Every number here is derived from the
// repository, never estimated; the comment next to it says where it comes from.

const providerLogo = (file) => `/providers/${file}.png`;

// Counts are visible (non-hidden) entries in ../open-sse/providers/registry/index.js,
// grouped by `serviceKinds`. Entries without `serviceKinds` default to ["llm"]
// (see ../src/shared/constants/providers.js). Snapshot taken for this page.
export const REGISTRY_PROVIDER_COUNT = 238;

// Routes are the directories under ../src/app/api/v1 plus MEDIA_PROVIDER_KINDS.
export const SERVICE_KINDS = [
  { id: "chat", icon: "chat", label: "Chat & code", route: "/v1/chat/completions", count: 195 },
  { id: "embedding", icon: "vector", label: "Embeddings", route: "/v1/embeddings", count: 14 },
  { id: "tts", icon: "voice", label: "Text to speech", route: "/v1/audio/speech", count: 13 },
  { id: "stt", icon: "mic", label: "Speech to text", route: "/v1/audio/transcriptions", count: 7 },
  { id: "image", icon: "image", label: "Image generation", route: "/v1/images/generations", count: 20 },
  { id: "vision", icon: "eye", label: "Vision", route: "image input", count: 12 },
  { id: "video", icon: "film", label: "Video", route: "/v1/video/generations", count: 4 },
  { id: "search", icon: "search", label: "Web search", route: "/v1/search", count: 17 },
  { id: "fetch", icon: "globe", label: "Web fetch", route: "/v1/web/fetch", count: 6 },
];

// Tier order mirrors docs/providers/free-and-local.mdx ("Primary subscription or paid API
// model → ... → Local model or free-tier model") and the combo strategies table.
export const FALLBACK_TIERS = [
  {
    tier: "Tier I",
    name: "Subscription",
    body: "The plan you already pay for, such as Claude Code or Codex, connected through OAuth.",
    model: "cc/claude-sonnet",
    logo: providerLogo("claude"),
  },
  {
    tier: "Tier II",
    name: "Cheap API",
    body: "Low-cost API keys and compatible endpoints take over when the subscription is rate limited.",
    model: "openrouter/qwen3-coder",
    logo: providerLogo("openrouter"),
  },
  {
    tier: "Tier III",
    name: "Free & local",
    body: "Free tiers or a local model keep the request alive when everything upstream says no.",
    model: "ollama-local/qwen3",
    logo: providerLogo("ollama"),
  },
];

// Default from docs/features/smart-routing.mdx: stickyRoundRobinLimit = 3.
export const STICKY_LIMIT = 3;

// Logos present in ../public/providers (copied by scripts/sync-public.mjs).
export const CONSTELLATION = {
  inner: ["openai", "anthropic", "gemini", "openrouter", "deepseek", "ollama"],
  middle: ["groq", "mistral", "xai", "qwen", "kimi", "glm", "minimax", "cohere", "nvidia", "perplexity"],
  outer: [
    "together", "fireworks", "cerebras", "huggingface", "vertex", "azure", "elevenlabs", "deepgram",
    "exa", "firecrawl", "recraft", "cartesia", "hyperbolic", "nebius",
  ],
};
export const constellationLogo = providerLogo;

// Engines documented in docs/features/compression.mdx and open-sse/rtk/.
export const SAVER_ENGINES = [
  { name: "RTK filters", body: "Condense tool output such as git status, git diff, ls, grep, find and build logs." },
  { name: "Caveman", body: "Rule-based prose compression with lite, full and ultra intensities." },
  { name: "Session dedup", body: "Drops blocks repeated across turns of the same conversation." },
  { name: "Headroom", body: "Optional adapter that only applies when it saves more than five percent." },
];

// Illustrative accounts for the quota panel. Values are sample data, labelled as such.
export const QUOTA_SAMPLE = [
  { name: "Claude Code", plan: "subscription", used: 0.82, reset: "resets in 1h 12m", logo: providerLogo("claude") },
  { name: "Codex", plan: "subscription", used: 0.46, reset: "resets in 3d", logo: providerLogo("codex") },
  { name: "Gemini", plan: "free tier", used: 0.27, reset: "resets daily", logo: providerLogo("gemini") },
];

// Commands from README.md "Quick start" and docs/deployment/docker.mdx.
export const DEPLOYMENTS = [
  {
    id: "npm",
    label: "npm",
    note: "Requires Node.js 20.20.2 and npm 10.8.2. Serves on port 20128.",
    command: "npm install -g durindoor\ndurindoor",
  },
  {
    id: "npx",
    label: "npx",
    note: "Try it without installing. Use a global install or Docker for daily use.",
    command: "npx durindoor",
  },
  {
    id: "docker",
    label: "Docker",
    note: "Bound to localhost with a volume so data survives. Pin a version tag in production.",
    command: `docker run -d --name durindoor \\
  -p 127.0.0.1:20128:20128 \\
  -v "$HOME/.durindoor:/app/data" \\
  -e DATA_DIR=/app/data \\
  -e JWT_SECRET="$(openssl rand -hex 32)" \\
  -e INITIAL_PASSWORD="$(openssl rand -hex 16)" \\
  ghcr.io/bloodf/durindoor:latest`,
  },
  {
    id: "source",
    label: "Source",
    note: "For contributors. `npm run dev` uses port 20127 instead.",
    command: `git clone https://github.com/bloodf/durindoor.git
cd durindoor
npm install --no-audit --no-fund
npm run build
npm start`,
  },
];

// Mock login password, from src/mock/handlers/core.js.
export { DEMO_PASSWORD } from "@site/mock/demoPassword.js";
