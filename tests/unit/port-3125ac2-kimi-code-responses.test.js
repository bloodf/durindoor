// Port of upstream 9router 3125ac2: Kimi Code natively serves the OpenAI
// Responses API (https://www.kimi.com/code/docs/en/third-party-tools/codex.html),
// so Responses clients of the API-key variant go straight to /coding/v1/responses.
// Chat and Claude clients keep their current transport, also with typed server
// tools. The OAuth variant (kimi-coding) is unchanged until a live OAuth check.
import { describe, expect, it } from "vitest";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const RESPONSES_URL = "https://api.kimi.com/coding/v1/responses";
const MESSAGES_URL = "https://api.kimi.com/coding/v1/messages";
const MODELS = ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"];
const apikey = (sourceFormat, { model = "k3", credentials = { apiKey: "k" }, body = null } = {}) =>
  resolveRequestTransport({ provider: "kimi-coding-apikey", alias: "kmca", model, sourceFormat, credentials, body });

describe("Kimi Code /responses transport (3125ac2)", () => {
  it("routes Responses clients of the API-key variant to the native endpoint", () => {
    for (const model of MODELS) {
      const { runtimeTransport, targetFormat } = apikey("openai-responses", { model });
      expect(targetFormat).toBe("openai-responses");
      expect(runtimeTransport.baseUrl).toBe(RESPONSES_URL);
    }
  });

  it("keeps Chat and Claude clients on /messages", () => {
    for (const sourceFormat of ["openai", "claude"]) {
      const { runtimeTransport, targetFormat } = apikey(sourceFormat);
      expect(targetFormat).toBe("claude");
      expect(runtimeTransport.baseUrl).toBe(MESSAGES_URL);
    }
  });

  it.each([
    ["claude", { type: "web_search_20250305", name: "web_search" }],
    ["claude", { type: "bash_20250124", name: "bash" }],
    ["claude", { type: "text_editor_20250124", name: "str_replace_editor" }],
    ["openai", { type: "web_search_preview" }],
  ])("keeps a %s client with a typed server tool on /messages", (sourceFormat, tool) => {
    const { runtimeTransport, targetFormat } = apikey(sourceFormat, { body: { tools: [tool] } });
    expect(targetFormat).toBe("claude");
    expect(runtimeTransport.baseUrl).toBe(MESSAGES_URL);
  });

  it("resolves without credentials to the provider default and no runtime transport", () => {
    for (const sourceFormat of ["openai-responses", "openai", "claude"]) {
      const { runtimeTransport, targetFormat } = apikey(sourceFormat, { credentials: null });
      expect(runtimeTransport).toBeNull();
      expect(targetFormat).toBe("claude");
    }
  });

  it("sends bearer auth to the responses URL", () => {
    const { runtimeTransport } = apikey("openai-responses");
    const executor = new DefaultExecutor("kimi-coding-apikey");
    const credentials = { apiKey: "kimi-key", runtimeTransport };
    expect(executor.buildUrl("k3", true, 0, credentials)).toBe(RESPONSES_URL);
    const headers = executor.buildHeaders(credentials, true);
    expect(headers.Authorization).toBe("Bearer kimi-key");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("leaves the OAuth variant without a Responses transport", () => {
    expect(PROVIDERS["kimi-coding"].transports.map((t) => t.format)).toEqual(["openai", "claude"]);
    const { runtimeTransport, targetFormat } = resolveRequestTransport({ provider: "kimi-coding", alias: "kmc", model: "k3", sourceFormat: "openai-responses", credentials: { apiKey: "k" } });
    expect(targetFormat).toBe("claude");
    expect(runtimeTransport.baseUrl).toBe(MESSAGES_URL);
  });
});
