// Server component: runs the real RTK `find` filter from open-sse at build time,
// so the before/after and the byte counts on the page are genuine output.
import { find } from "open-sse/rtk/filters/find.js";
import TokenSaversView from "./TokenSaversView.jsx";

// A `find . -type f` an agent might run in this repository, abbreviated to the
// provider registry and the translator. The paths are real files in ../open-sse.
const REGISTRY = [
  "9router", "agentrouter", "aihorde", "alibaba", "anthropic", "antigravity", "assemblyai", "azure", "baidu",
  "bedrock", "black-forest-labs", "brave-search", "cartesia", "cerebras", "claude", "cline", "codex", "cohere",
  "copilot-web", "cursor", "deepgram", "deepseek", "elevenlabs", "exa", "firecrawl", "fireworks", "gemini",
  "github", "glm", "groq", "huggingface", "kimi", "kiro", "minimax", "mistral", "nvidia", "ollama", "ollama-local",
  "openai", "openrouter", "perplexity", "qwen", "together", "vertex", "xai",
];
const TRANSLATOR = ["index", "validate", "webTools", "formats"];
const FORMATS = ["claude", "gemini", "responsesApi", "openai", "maxTokens"];

const RAW = [
  ...REGISTRY.map((id) => `./open-sse/providers/registry/${id}.js`),
  ...TRANSLATOR.map((id) => `./open-sse/translator/${id}.js`),
  ...FORMATS.map((id) => `./open-sse/translator/formats/${id}.js`),
].join("\n");

const bytes = (text) => new TextEncoder().encode(text).length;

export default function TokenSavers() {
  const compressed = find(RAW);
  return (
    <TokenSaversView
      raw={RAW}
      compressed={compressed}
      before={bytes(RAW)}
      after={bytes(compressed)}
    />
  );
}
