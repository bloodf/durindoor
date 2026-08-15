/**
 * Grok CLI / Grok Build (cli-chat-proxy.grok.com)
 *
 * Source of truth: HAR capture of official grok-shell/grok-pager talking to
 * https://cli-chat-proxy.grok.com (OpenAI Responses API).
 *
 * Distinct from:
 *  - `xai`      → api.x.ai (API key / Grok Build OAuth PKCE)
 *  - `grok-web` → grok.com web SSO cookie
 *
 * Ported from decolua/9router#2502 (device-code OAuth + Responses executor).
 */
import xai from "./xai.js";

export default {
  id: "grok-cli",
  priority: 42,
  // `gb` is the established primary alias (model catalog is keyed by primary
  // alias, see open-sse/providers/index.js). Keep the upstream aliases as
  // secondary lookups while leaving `gc` reserved for Gemini CLI.
  alias: "gb",
  aliases: ["gcli", "grok-build"],
  uiAlias: "gb",
  display: {
    name: "Grok CLI (Grok Build)",
    icon: "terminal",
    color: "#111827",
    textIcon: "GC",
    website: "https://x.ai",
    notice: {
      text: "Sign in with your xAI / Grok account via device code. Uses Grok Build subscription credits (cli-chat-proxy.grok.com).",
      signupUrl: "https://grok.com/supergrok",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  thinkingConfig: {
    options: ["low", "medium", "high"],
    defaultMode: "high",
  },
  transport: {
    // OpenAI Responses API on the Grok CLI chat proxy.
    baseUrl: "https://cli-chat-proxy.grok.com/v1/responses",
    format: "openai-responses",
    forceStream: true,
    modelsUrl: "https://cli-chat-proxy.grok.com/v1/models",
    userUrl: "https://cli-chat-proxy.grok.com/v1/user",
    clientVersion: "0.2.93",
    clientIdentifier: "grok-pager",
    tokenAuth: "xai-grok-cli",
    headers: {
      "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-identifier": "grok-pager",
      "x-grok-client-version": "0.2.93",
      "x-authenticateresponse": "authenticate-response",
    },
    // Compaction threshold mirrored from CLI (x-compaction-at).
    compactionAt: 400000,
    retry: {
      429: { attempts: 2, delayMs: 2000 },
      502: { attempts: 2, delayMs: 1500 },
      503: { attempts: 2, delayMs: 1500 },
    },
  },
  models: [
    {
      id: "grok-build",
      name: "Grok Build",
      contextLength: 256000,
      unsupportedParams: ["presencePenalty", "frequencyPenalty", "logprobs", "topLogprobs"],
    },
    {
      id: "grok-composer-2.5-fast",
      name: "Grok Composer 2.5 Fast",
      contextLength: 200000,
      unsupportedParams: ["presencePenalty", "frequencyPenalty", "logprobs", "topLogprobs"],
    },
    // Grok 4.5 family served by cli-chat-proxy; effort suffixes are virtual
    // models that map to the same upstream id with a reasoning effort.
    { id: "grok-4.5", name: "Grok 4.5", contextLength: 500000 },
    { id: "grok-4.5-high", name: "Grok 4.5 (High)", upstreamModelId: "grok-4.5", contextLength: 500000 },
    { id: "grok-4.5-medium", name: "Grok 4.5 (Medium)", upstreamModelId: "grok-4.5", contextLength: 500000 },
    { id: "grok-4.5-low", name: "Grok 4.5 (Low)", upstreamModelId: "grok-4.5", contextLength: 500000 },
  ],
  passthroughModels: true,
  oauth: {
    // Same public client_id as the existing xai OAuth client.
    clientId: xai.transport.clientId,
    deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
    // Device-code flow (no PKCE) to auth.x.ai.
    flowType: "device_code",
    // HAR scope includes conversations read/write beyond the api-only xai scope.
    scope:
      "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
    referrer: "grok-build",
    refresh: { encoding: "form" },
    refreshLeadMs: 5 * 60 * 1000,
  },
  features: { usage: true, oauth: true },
  usage: { url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits", userUrl: "https://cli-chat-proxy.grok.com/v1/user?include=subscription" },
}
