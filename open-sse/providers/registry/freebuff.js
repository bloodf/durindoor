// Staged Freebuff provider, ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878), MIT:
//   open-sse/config/providers/registry/freebuff/index.ts
//   open-sse/executors/freebuff.ts
//   src/lib/oauth/providers/freebuff.ts (+ FREEBUFF_CONFIG in src/lib/oauth/constants/oauth.ts)
//
// Freebuff is the free, ad-supported Codebuff product. Its CLI login produces a
// device-session `authToken`, which is NOT a paid `cb_...` Codebuff API key, so
// this entry is a separate identity from any Codebuff connection and never
// reads or writes one. See internal/docs/freebuff-provider-contract.md and
// docs/providers/freebuff.mdx.
//
// The chat flow is a reverse-engineered client of Freebuff service endpoints,
// not a documented third-party API. Dispatch is therefore off unless the
// connection sets providerSpecificData.enableSessionDispatch === true.

export const FREEBUFF_API_BASE = "https://www.codebuff.com/api/v1";
export const FREEBUFF_OPT_IN_KEY = "enableSessionDispatch";

// Freebuff device login ("fingerprint" flow). The auth token has no refresh
// grant: an expired token needs a fresh login.
export const FREEBUFF_OAUTH = Object.freeze({
  baseUrl: "https://freebuff.com",
  codeUrl: "https://freebuff.com/api/auth/cli/code",
  statusUrl: "https://freebuff.com/api/auth/cli/status",
  pollInterval: 5000,
  loginTimeoutSec: 300,
});

// Freebuff signs in with a device session, so there is no browser cookie to
// capture. Exported so the registration batch can see the contract is
// intentionally empty and skip extension/dashboard cookie wiring.
export const freebuffCookieProfile = Object.freeze({
  notApplicable: true,
  domains: Object.freeze([]),
  cookieNames: Object.freeze([]),
  validationProbe: null,
});

// Connection opt-in. Dispatch stays off until the connection sets
// providerSpecificData.enableSessionDispatch to the boolean true.
export const freebuffConnectionOptIn = Object.freeze({ providerSpecificData: FREEBUFF_OPT_IN_KEY });

// Model id -> Freebuff agent id (the executor sends the agent id with every run).
export const FREEBUFF_AGENT_BY_MODEL = Object.freeze({
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base2-free-deepseek",
  "openai/gpt-5.6-luna": "base2-free-luna",
  "minimax/minimax-m3": "base2-free-minimax-m3",
  "mimo/mimo-v2.5": "base2-free-mimo",
  "z-ai/glm-5.2": "base2-free-glm",
  "crof/kimi-k3-eco": "base2-free-kimi-k3-eco",
  "anthropic/claude-fable-5": "base2-free-fable",
  "meta/muse-spark-1.2-contributor": "base2-free-muse-spark",
});

export const FREEBUFF_MODELS = Object.freeze([
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsReasoning: true, contextLength: 131072 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true, contextLength: 131072 },
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", supportsReasoning: true, contextLength: 131072 },
  { id: "minimax/minimax-m3", name: "MiniMax M3", supportsVision: true, supportsReasoning: true, contextLength: 131072 },
  { id: "mimo/mimo-v2.5", name: "MiMo v2.5", supportsReasoning: true, contextLength: 131072 },
  { id: "z-ai/glm-5.2", name: "GLM 5.2", supportsReasoning: true, contextLength: 131072 },
  { id: "crof/kimi-k3-eco", name: "Kimi K3 Eco", supportsVision: true, supportsReasoning: true, contextLength: 131072 },
  {
    id: "anthropic/claude-fable-5",
    name: "Claude Fable 5",
    supportsVision: true,
    supportsReasoning: true,
    contextLength: 131072,
    supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  { id: "meta/muse-spark-1.2-contributor", name: "Meta Muse Spark 1.2 Contributor", supportsReasoning: true, contextLength: 131072 },
]);

export default {
  id: "freebuff",
  alias: "fb",
  priority: 62,
  display: {
    name: "Freebuff (session, opt-in)",
    icon: "bolt",
    color: "#10B981",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      text: "Unofficial. Uses a Freebuff device-session login (not a paid Codebuff key) against undocumented Freebuff service endpoints. Off until the connection sets providerSpecificData.enableSessionDispatch to true; see the provider docs.",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  hasFree: true,
  transport: {
    baseUrl: FREEBUFF_API_BASE,
    format: "openai",
    executor: "freebuff",
  },
  oauth: { ...FREEBUFF_OAUTH },
  models: FREEBUFF_MODELS.map((model) => ({ ...model })),
  serviceKinds: ["llm"],
};
