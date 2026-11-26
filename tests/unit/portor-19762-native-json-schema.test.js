import { describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { normalizeProviderSpecificData } from "../../src/lib/providerNormalization.js";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";
import { SAFE_PSD_EXPORT_FIELDS } from "../../src/lib/db/helpers/providerSpecificDataSecrets.js";

const provider = "openai-compatible-chat-test";
const request = () => ({
  model: "test",
  messages: [{ role: "user", content: "hello" }],
  response_format: { type: "json_schema", json_schema: { name: "s", schema: { type: "object" } } },
});

async function send(id, providerSpecificData) {
  const fetcher = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  await new DefaultExecutor(id).execute({
    model: "test",
    body: request(),
    stream: false,
    credentials: { apiKey: "mock", providerSpecificData: { baseUrl: "https://example.invalid/v1", ...providerSpecificData } },
    directFetch: fetcher,
  });
  expect(fetcher).toHaveBeenCalledOnce();
  return JSON.parse(fetcher.mock.calls[0][1].body);
}

describe("OmniRoute #19762 — per-connection native json_schema opt-out", () => {
  it("forwards json_schema unchanged on an opted-in compatible connection", async () => {
    const sent = await send(provider, { nativeJsonSchema: true });
    expect(sent.response_format).toEqual(request().response_format);
    expect(sent.messages).toEqual(request().messages);
  });

  it.each([[undefined], [false], ["true"]])("keeps the downgrade for %s", async (nativeJsonSchema) => {
    const sent = await send(provider, { nativeJsonSchema });
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.messages[0].role).toBe("system");
  });

  it("keeps the DeepSeek downgrade even with the flag", () => {
    const out = new DefaultExecutor("deepseek").applyJsonSchemaFallback(request(), {
      providerSpecificData: { nativeJsonSchema: true },
    });
    expect(out.response_format).toEqual({ type: "json_object" });
  });

  it("stores only a boolean opt-in on compatible chat connections and keeps it in views and exports", () => {
    const data = normalizeProviderSpecificData(provider, {}, { nativeJsonSchema: true });
    expect(data.nativeJsonSchema).toBe(true);
    expect(sanitizeProviderConnectionForClient({ provider, providerSpecificData: data }).providerSpecificData.nativeJsonSchema).toBe(true);
    expect(SAFE_PSD_EXPORT_FIELDS).toContain("nativeJsonSchema");
    expect(normalizeProviderSpecificData(provider, {}, { nativeJsonSchema: "true" }).nativeJsonSchema).toBe(false);
    expect(normalizeProviderSpecificData("openai-compatible-responses-test", {}, { nativeJsonSchema: true }).nativeJsonSchema).toBe(false);
    expect(normalizeProviderSpecificData("deepseek", {}, { nativeJsonSchema: true }).nativeJsonSchema).toBe(false);
  });
});
