import { AntigravityExecutor } from "./antigravity.js";
import { AuggieExecutor } from "./auggie.js";
import { AzureExecutor } from "./azure.js";
import { AzureOpenAIExecutor } from "./azure-openai.js";
import { BedrockExecutor } from "./bedrock.js";
import { ChipotleExecutor } from "./chipotle.js";
import { GeminiCLIExecutor } from "./gemini-cli.js";
import { GithubExecutor } from "./github.js";
import { IFlowExecutor } from "./iflow.js";
import { InnerAiExecutor } from "./inner-ai.js";
import { QoderExecutor } from "./qoder.js";
import { DuckDuckGoWebExecutor } from "./duckduckgo-web.js";
import { KiroExecutor } from "./kiro.js";
import { KimchiExecutor } from "./kimchi.js";
import { KimiWebExecutor } from "./kimi-web.js";
import { CodexExecutor } from "./codex.js";
import { CursorExecutor } from "./cursor.js";
import { VertexExecutor } from "./vertex.js";
import { QwenExecutor } from "./qwen.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeZenExecutor } from "./opencode-zen.js";
import { GrokWebExecutor } from "./grok-web.js";
import { PerplexityWebExecutor } from "./perplexity-web.js";
import { OllamaLocalExecutor } from "./ollama-local.js";
import { CommandCodeExecutor } from "./commandcode.js";
import { PollinationsExecutor } from "./pollinations.js";
import { PuterExecutor } from "./puter.js";
import { TheOldLlmExecutor } from "./theoldllm.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { MimoFreeExecutor } from "./mimo-free.js";
import { MimocodeExecutor } from "./mimocode.js";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { XaiExecutor } from "./xai.js";
import { GrokCliExecutor } from "./grok-cli.js";
import { GitlabExecutor } from "./gitlab.js";
import { TraeExecutor } from "./trae.js";
import { DevinCliExecutor } from "./devin-cli.js";
import { WindsurfExecutor } from "./windsurf.js";
import { DefaultExecutor } from "./default.js";
import { CopilotWebExecutor } from "./copilot-web.js";
import { CopilotM365WebExecutor } from "./copilot-m365-web.js";
import { VeoAIFreeWebExecutor } from "./veoaifree-web.js";
import { ZenmuxFreeExecutor } from "./zenmux-free.js";
import {
  UnsupportedOmniRouteWebSessionExecutor,
  BLOCKED_OMNIROUTE_PROVIDERS,
  BLOCKED_OMNIROUTE_PROVIDER_ALIASES,
} from "./unsupported-websession.js";
import REGISTRY from "../providers/registry/index.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  agy: new AntigravityExecutor("agy"),
  auggie: new AuggieExecutor(),
  aug: new AuggieExecutor(), // Alias for auggie
  azure: new AzureExecutor(),
  "azure-openai": new AzureOpenAIExecutor(),
  bedrock: new BedrockExecutor(),
  chipotle: new ChipotleExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  github: new GithubExecutor(),
  iflow: new IFlowExecutor(),
  "inner-ai": new InnerAiExecutor(),
  "in-ai": new InnerAiExecutor(), // Alias for inner-ai
  qoder: new QoderExecutor(),
  "duckduckgo-web": new DuckDuckGoWebExecutor(),
  ddgw: new DuckDuckGoWebExecutor(),
  kiro: new KiroExecutor(),
  kimchi: new KimchiExecutor(),
  "kimi-web": new KimiWebExecutor(),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  vertex: new VertexExecutor("vertex"),
  "vertex-partner": new VertexExecutor("vertex-partner"),
  qwen: new QwenExecutor(),
  opencode: new OpenCodeExecutor(),
  "opencode-zen": new OpenCodeZenExecutor(),
  "grok-web": new GrokWebExecutor(),
  "perplexity-web": new PerplexityWebExecutor(),
  "ollama-local": new OllamaLocalExecutor(),
  commandcode: new CommandCodeExecutor(),
  "command-code": new CommandCodeExecutor("command-code"),
  pollinations: new PollinationsExecutor(),
  pol: new PollinationsExecutor(),
  puter: new PuterExecutor(),
  theoldllm: new TheOldLlmExecutor(),
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
  "mimo-free": new MimoFreeExecutor(),
  mimocode: new MimocodeExecutor(),
  mcode: new MimocodeExecutor(), // Alias for mimocode
  mmf: new MimoFreeExecutor(), // Alias for mimo-free
  "codebuddy-cn": new CodeBuddyExecutor(),
  xai: new XaiExecutor(),
  "grok-cli": new GrokCliExecutor(),
  "gitlab-duo": new GitlabExecutor("gitlab-duo"),
  trae: new TraeExecutor(),
  "devin-cli": new DevinCliExecutor(),
  windsurf: new WindsurfExecutor(),
  "copilot-web": new CopilotWebExecutor(),
  copilot: new CopilotWebExecutor(),
  "copilot-m365-web": new CopilotM365WebExecutor(),
  m365copilot: new CopilotM365WebExecutor(),
  "veoaifree-web": new VeoAIFreeWebExecutor(),
  "veo-free": new VeoAIFreeWebExecutor(),
  "zenmux-free": new ZenmuxFreeExecutor(),
  zmf: new ZenmuxFreeExecutor(),
  ...Object.fromEntries(
    Object.keys(BLOCKED_OMNIROUTE_PROVIDERS).map((provider) => [
      provider,
      new UnsupportedOmniRouteWebSessionExecutor(provider),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(BLOCKED_OMNIROUTE_PROVIDER_ALIASES).map(([alias, provider]) => [
      alias,
      new UnsupportedOmniRouteWebSessionExecutor(provider),
    ]),
  ),
};

const defaultCache = new Map();

// #10394 — providers that exist ONLY as /v1/search endpoint entries (searchConfig but no
// transport in open-sse/providers/registry/) and have no chat-completions REGISTRY entry
// anywhere in open-sse/. Without this guard, getExecutor() silently falls through to
// DefaultExecutor's `PROVIDERS[provider] || PROVIDERS.openai` fallback, sending the user's
// real search API key (e.g. a Tavily `tvly-...` key) to OpenAI's endpoint. Search providers
// must be routed through /v1/search, never the chat-completions path. The set is derived
// from the registry so a new search-only provider is picked up automatically.
const CHAT_UNSUPPORTED_SEARCH_PROVIDERS = new Set(
  REGISTRY
    .filter((entry) => entry.searchConfig && !entry.transport)
    .flatMap((entry) => [
      entry.id,
      entry.alias,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ])
    .filter(Boolean),
);

export function getExecutor(provider) {
  if (executors[provider]) return executors[provider];
  if (CHAT_UNSUPPORTED_SEARCH_PROVIDERS.has(provider)) {
    const err = new Error(
      `Provider "${provider}" is a search provider and does not support chat completions; use the /v1/search endpoint instead.`,
    );
    err.status = 400;
    throw err;
  }
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  return !!executors[provider];
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { AuggieExecutor } from "./auggie.js";
export { AzureExecutor } from "./azure.js";
export { AzureOpenAIExecutor } from "./azure-openai.js";
export { BedrockExecutor } from "./bedrock.js";
export { ChipotleExecutor } from "./chipotle.js";
export { GeminiCLIExecutor } from "./gemini-cli.js";
export { GithubExecutor } from "./github.js";
export { IFlowExecutor } from "./iflow.js";
export { InnerAiExecutor } from "./inner-ai.js";
export { QoderExecutor } from "./qoder.js";
export { KiroExecutor } from "./kiro.js";
export { KimchiExecutor } from "./kimchi.js";
export { KimiWebExecutor } from "./kimi-web.js";
export { CodexExecutor } from "./codex.js";
export { CursorExecutor } from "./cursor.js";
export { VertexExecutor } from "./vertex.js";
export { DefaultExecutor } from "./default.js";
export { QwenExecutor } from "./qwen.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeZenExecutor } from "./opencode-zen.js";
export { GrokWebExecutor } from "./grok-web.js";
export { PerplexityWebExecutor } from "./perplexity-web.js";
export { OllamaLocalExecutor } from "./ollama-local.js";
export { CommandCodeExecutor } from "./commandcode.js";
export { PollinationsExecutor } from "./pollinations.js";
export { PuterExecutor } from "./puter.js";
export { TheOldLlmExecutor } from "./theoldllm.js";
export { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
export { MimoFreeExecutor } from "./mimo-free.js";
export { MimocodeExecutor } from "./mimocode.js";
export { CodeBuddyExecutor } from "./codebuddy-cn.js";
export { XaiExecutor } from "./xai.js";
export { GrokCliExecutor } from "./grok-cli.js";
export { GitlabExecutor } from "./gitlab.js";
export { TraeExecutor } from "./trae.js";
export { DevinCliExecutor } from "./devin-cli.js";
export { WindsurfExecutor } from "./windsurf.js";
export { CopilotWebExecutor } from "./copilot-web.js";
export { CopilotM365WebExecutor } from "./copilot-m365-web.js";
export { VeoAIFreeWebExecutor } from "./veoaifree-web.js";
export { ZenmuxFreeExecutor } from "./zenmux-free.js";
export {
  UnsupportedOmniRouteWebSessionExecutor,
  BLOCKED_OMNIROUTE_PROVIDERS,
  BLOCKED_OMNIROUTE_PROVIDER_ALIASES,
} from "./unsupported-websession.js";
