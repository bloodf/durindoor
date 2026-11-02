// Port of upstream 9router 3125ac2: Kimi Code natively serves the OpenAI
// Responses API (https://www.kimi.com/code/docs/en/third-party-tools/codex.html),
// so Responses clients go straight to /coding/v1/responses. Chat and Claude
// clients keep their current transport.
import { describe, expect, it } from "vitest";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const RESPONSES_URL = "https://api.kimi.com/coding/v1/responses";
const MESSAGES_URL = "https://api.kimi.com/coding/v1/messages";
const cases = [["kimi-coding", "kmc"], ["kimi-coding-apikey", "kmca"]];

describe("Kimi Code /responses transport (3125ac2)", () => {
  it.each(cases)("routes Responses clients of %s to the native endpoint", (provider, alias) => {
    for (const model of ["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"]) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({ provider, alias, model, sourceFormat: "openai-responses", credentials: { apiKey: "k" } });
      expect(targetFormat).toBe("openai-responses");
      expect(runtimeTransport.baseUrl).toBe(RESPONSES_URL);
    }
  });

  it.each(cases)("keeps Chat and Claude clients of %s on the current Messages transport", (provider, alias) => {
    for (const sourceFormat of ["openai", "claude"]) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({ provider, alias, model: "k3", sourceFormat, credentials: { apiKey: "k" } });
      expect(targetFormat).toBe("claude");
      expect(runtimeTransport.baseUrl).toBe(MESSAGES_URL);
    }
  });

  it.each(cases)("sends bearer auth to the %s responses URL", (provider, alias) => {
    const { runtimeTransport } = resolveRequestTransport({ provider, alias, model: "k3", sourceFormat: "openai-responses", credentials: { apiKey: "k" } });
    const executor = new DefaultExecutor(provider);
    const credentials = { apiKey: "kimi-key", runtimeTransport };
    expect(executor.buildUrl("k3", true, 0, credentials)).toBe(RESPONSES_URL);
    const headers = executor.buildHeaders(credentials, true);
    expect(headers.Authorization).toBe("Bearer kimi-key");
    expect(headers["x-api-key"]).toBeUndefined();
  });
});
