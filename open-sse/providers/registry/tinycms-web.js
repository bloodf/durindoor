// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/tinycms/index.ts (MIT).
const reasoning = { supportsReasoning: true };

const MODELS = [
  { id: "claude-fable-5", name: "Claude Fable 5", ...reasoning, supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
  { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
  { id: "gpt-5.5", name: "GPT 5.5" },
  { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
  { id: "gpt-5.4-nano", name: "GPT 5.4 Nano" },
  { id: "gpt-5.3-thinking-free", name: "GPT 5.3 Thinking Free", ...reasoning },
  { id: "gpt-5.3-free", name: "GPT 5.3 Free (Multimodal/Vision)" },
  { id: "gpt-oss-120b", name: "GPT-OSS 120B" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
  { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite" },
  { id: "grok-4.5", name: "Grok 4.5" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "kimi-k3", name: "Kimi K3" },
  { id: "glm-5.2", name: "GLM 5.2" },
  { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
  { id: "mimo-v2.5-pro", name: "Mimo V2.5 Pro" },
  { id: "mimo-v2.5", name: "Mimo V2.5" },
];

/**
 * Capture/import profile for the extension and dashboard import. TinyCMS has no
 * session cookie: the device identity is the `app-config-uuid` localStorage value
 * (starts with `R`) on site.tinycms.xyz. `cookieNames` is empty on purpose, so a
 * Cookie header, cURL or HAR carries nothing to import; the extension reads the
 * localStorage key instead. The validation probe is the signed-challenge endpoint,
 * which needs the `uuid` header and answers 200 with a challenge for a live device.
 *
 * The same profile is the provider's `cookieImport` block: the dashboard import and
 * the extension send the value as a named localStorage item, and the import API
 * stores it in `providerSpecificData["app-config-uuid"]` (see `apiKeyOptionalWith`).
 */
export const TINYCMS_WEB_CREDENTIAL_PROFILE = Object.freeze({
  origin: "https://site.tinycms.xyz",
  domains: ["site.tinycms.xyz", "gov.freegpt.win"],
  cookieNames: [],
  localStorageKeys: ["app-config-uuid"],
  credentialPattern: "^R[\\x21-\\x7e]{3,}$",
  validationProbe: {
    url: "https://gov.freegpt.win/api/challenge",
    method: "GET",
    headers: { uuid: "{credential}", "x-origin": "https://gov.freegpt.win" },
    okStatus: [200],
  },
});

export default {
  id: "tinycms-web",
  alias: "tcw",
  priority: 258,
  display: { name: "TinyCMS Web", icon: "hub", color: "#5B5BD6", textIcon: "TC", website: "https://site.tinycms.xyz" },
  category: "apikey",
  authType: "apikey",
  authHint: "Use the device UUID beginning with R from site.tinycms.xyz (localStorage app-config-uuid).",
  // An imported device UUID is stored here instead of in the API-key field.
  apiKeyOptionalWith: "app-config-uuid",
  cookieImport: { ...TINYCMS_WEB_CREDENTIAL_PROFILE, extensionCapture: true },
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://gov.freegpt.win/api/openai/oneapi/v1/chat/completions",
    format: "openai",
    executor: "tinycms-web",
    authType: "apikey",
  },
  models: MODELS,
};
