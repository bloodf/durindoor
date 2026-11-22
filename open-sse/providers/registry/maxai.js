// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/maxai/index.ts and executors/maxai.ts.
export const cookieCaptureProfile = Object.freeze({
  origin: "https://www.maxai.co",
  domains: ["maxai.co", "maxai.me"],
  cookieNames: ["access_token", "device_id", "user_id"],
  validationProbe: { url: "https://api.maxai.me/models/get_config", method: "GET", okStatus: [200] },
});
const models = [
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextLength: 1050000, supportsVision: true },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextLength: 200000, supportsVision: true },
  { id: "gemini-3-1-flash-lite", name: "Gemini 3.1 Flash Lite", contextLength: 1000000, supportsVision: true },
  { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast", contextLength: 2000000 },
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", contextLength: 128000 },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2", contextLength: 128000 },
  { id: "gpt-5.6", name: "GPT-5.6", contextLength: 1050000, supportsVision: true },
  { id: "claude-5-sonnet", name: "Claude 5 Sonnet", contextLength: 1000000 },
  { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast (Reasoning)", contextLength: 2000000, supportsReasoning: true },
  { id: "gpt-5.6-thinking", name: "GPT-5.6 Thinking", contextLength: 1050000, supportsReasoning: true, supportsVision: true },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", contextLength: 1000000, supportsReasoning: true, supportsVision: true },
  { id: "grok-4.5", name: "Grok 4.5", contextLength: 500000, supportsReasoning: true },
  { id: "deepseek-r1", name: "DeepSeek R1", contextLength: 128000, supportsReasoning: true },
];
export default {
  id: "maxai", alias: "mx",
  display: { name: "MaxAI", icon: "hub", color: "#6B5CE7", textIcon: "MX", website: "https://www.maxai.co", notice: { text: "Capture the MaxAI browser session and its access token, device ID and user ID. The token is minted by MaxAI's web app.", apiKeyUrl: "https://www.maxai.co/app/" } },
  category: "webCookie", authType: "cookie", authHint: "Import MaxAI session cookies and the browser-minted access_token, device_id and user_id values.", cookieImport: { ...cookieCaptureProfile, extensionCapture: true },
  serviceKinds: ["llm"], transport: { baseUrl: "https://api.maxai.me/gpt/cwc/chat", format: "openai", executor: "maxai", authType: "cookie" }, models, passthroughModels: true,
};
