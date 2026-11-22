// Staged Devin Desktop port from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878), MIT:
//   open-sse/config/providers/registry/devin-desktop/index.ts
//   open-sse/config/providers/registry/devin/catalog.ts
// Chat needs the provider-specific executor open-sse/executors/devin-desktop.js (Connect
// protobuf, GetUserJwt preflight). The sign-in lives in src/lib/oauth/services/devin-desktop.js.
// The registration batch wires both; see docs/providers/devin-desktop.mdx.
import { DEVIN_DESKTOP_CONFIG } from "../../../src/lib/oauth/services/devin-desktop.js";

const QUALITY = [["max", "Max"], ["xhigh", "XHigh"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];
const GPT = [["max", "Max Thinking"], ["xhigh", "XHigh Thinking"], ["high", "High Thinking"], ["medium", "Medium Thinking"], ["low", "Low Thinking"], ["none", "No Thinking"]];

const model = (id, name, maxOutputTokens, contextLength) => {
  const entry = { id, name };
  if (maxOutputTokens !== undefined) entry.maxOutputTokens = maxOutputTokens;
  if (contextLength !== undefined) entry.contextLength = contextLength;
  return entry;
};
const efforts = (id, name, out, ctx, list = QUALITY) => list.map(([suffix, label]) => model(`${id}-${suffix}`, `${name} ${label}`, out, ctx));
const fastEfforts = (id, name, out, ctx) => QUALITY.flatMap(([suffix, label]) => [model(`${id}-${suffix}-fast`, `${name} ${label} Fast`, out, ctx), model(`${id}-${suffix}`, `${name} ${label}`, out, ctx)]);
const gpt = (id, name) => GPT.flatMap(([suffix, label]) => [model(`${id}-${suffix}-priority`, `${name} ${label} Fast`, 128000, 1000000), model(`${id}-${suffix}`, `${name} ${label}`, 128000, 1000000)]);
const HML = [["max", "Max"], ["high", "High"], ["low", "Low"]];

// Curated upstream catalog (authenticated `devin models list` on 2026-09-02, per the pinned source).
// Live ids from GetCliModelConfigs discovery win membership; these entries supply names and limits.
export const DEVIN_MODEL_CATALOG = [
  ...efforts("claude-fable-5-1", "Claude Fable 5.1", 128000, 1000000),
  ...fastEfforts("claude-opus-5", "Claude Opus 5", 128000, 1000000),
  ...fastEfforts("claude-opus-4-8", "Claude Opus 4.8", 128000, 1000000),
  ...efforts("claude-sonnet-5", "Claude Sonnet 5", 128000, 1000000),
  model("claude-sonnet-4-6-thinking-1m", "Claude Sonnet 4.6 Thinking 1M", 128000, 1000000),
  model("claude-sonnet-4-6-1m", "Claude Sonnet 4.6 1M", 128000, 1000000),
  model("claude-sonnet-4-6-thinking", "Claude Sonnet 4.6 Thinking", 128000, 200000),
  model("claude-sonnet-4-6", "Claude Sonnet 4.6", 128000, 200000),
  model("MODEL_PRIVATE_11", "Claude Haiku 4.5", 64000, 200000),
  ...gpt("gpt-5-6-sol", "GPT-5.6 Sol"),
  ...gpt("gpt-5-6-terra", "GPT-5.6 Terra"),
  ...gpt("gpt-5-6-luna", "GPT-5.6 Luna"),
  ...efforts("kimi-k3", "Kimi K3", 131072, 1048576, HML),
  model("kimi-k2-7", "Kimi K2.7", 16000, 262144),
  ...efforts("glm-5-3", "GLM-5.3", 128000, 1000000, HML),
  ...efforts("glm-5-3-flash", "GLM-5.3 Flash", 128000, 1000000, HML),
  model("swe-1-7", "SWE-1.7 Max", 128000, 262000),
  model("swe-1-7-medium", "SWE-1.7 Medium", 128000, 262000),
  model("swe-1-7-lightning", "SWE-1.7 Lightning Max", 96000, 202752),
  model("swe-1-7-lightning-medium", "SWE-1.7 Lightning Medium", 96000, 202752),
  model("adaptive", "Adaptive"),
  ...efforts("grok-4-6", "Grok 4.6", 100000, 500000, [["xhigh", "XHigh"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]),
  ...efforts("inkling", "Inkling", 131072, undefined, [["max", "Max"], ["xhigh", "X-High"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["none", "None"]]),
  ...efforts("deepseek-v4-flash", "DeepSeek V4 Flash", 384000, 1000000, HML),
  ...efforts("nemotron-3-ultra", "Nemotron 3 Ultra", 32768, 262144, [["high", "High"], ["medium", "Medium"], ["none", "None"]]),
  ...efforts("gemini-3-7-flash", "Gemini 3.7 Flash", 65535, 1048576, [["high", "High"], ["medium", "Medium"], ["low", "Low"]]),
  ...efforts("gemini-3-1-pro", "Gemini 3.1 Pro", 65535, 1048576, [["high", "High Thinking"], ["low", "Low Thinking"]]),
  ...efforts("deepseek-v4-pro", "DeepSeek V4 Pro", 384000, 1000000, HML),
];

/**
 * Capture/import profile for the extension and the dashboard import. Devin Desktop has no
 * session cookie: the credential is the Devin session token (`devin-session-token$...`) or an
 * API key, pasted in or minted by the browser sign-in. `cookieNames` is empty on purpose, so a
 * Cookie header, cURL or HAR carries nothing to import. The validation probe is the unary
 * GetUserJwt call, which answers 200 with a user JWT for a live token (validateDevinDesktopSession).
 */
export const DEVIN_DESKTOP_CREDENTIAL_PROFILE = Object.freeze({
  origin: "https://app.devin.ai",
  domains: ["app.devin.ai", "api.devin.ai", "server.codeium.com"],
  cookieNames: [],
  tokenPrefix: "devin-session-token$",
  credentialPattern: "^\\S{16,}$",
  validationProbe: {
    url: "https://server.codeium.com/exa.auth_pb.AuthService/GetUserJwt",
    method: "POST",
    contentType: "application/proto",
    bodyEncoder: "encodeDevinDesktopAuthRequest",
    okStatus: [200],
  },
});

/** Per-connection opt-in: dispatch stays off unless providerSpecificData.enableSessionDispatch === true. */
export const devinDesktopConnectionOptIn = Object.freeze({ providerSpecificData: "enableSessionDispatch" });

export default {
  id: "devin-desktop",
  priority: 100,
  display: {
    name: "Devin Desktop",
    icon: "terminal",
    color: "#6366F1",
    textIcon: "DD",
    website: "https://devin.ai",
    notice: {
      text: "Experimental. Re-serves your Devin account through its desktop transport. Off until the connection sets providerSpecificData.enableSessionDispatch to true; see the provider docs. Session tokens do not refresh.",
    },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  authHint: "Sign in with Devin in the browser, or paste an existing Devin session token or API key. Key export availability and steps vary by Devin version and account.",
  transport: {
    baseUrl: DEVIN_DESKTOP_CONFIG.apiServerUrl,
    format: "openai",
    executor: "devin-desktop",
    forceStream: true,
    defaultContextLength: 200000,
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  oauth: {
    flowType: "import_token",
    supportsBrowserPkce: true,
    authorizeUrl: DEVIN_DESKTOP_CONFIG.authorizeUrl,
    tokenUrl: DEVIN_DESKTOP_CONFIG.tokenUrl,
    codeChallengeMethod: DEVIN_DESKTOP_CONFIG.codeChallengeMethod,
    fixedPort: DEVIN_DESKTOP_CONFIG.callbackPort,
    callbackPath: DEVIN_DESKTOP_CONFIG.callbackPath,
  },
  models: DEVIN_MODEL_CATALOG,
  serviceKinds: ["llm"],
};
