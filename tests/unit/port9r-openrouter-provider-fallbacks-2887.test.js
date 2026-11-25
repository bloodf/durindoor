import { describe, expect, it } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

const chat = (extra = {}) => ({ model: "openrouter/fusion", messages: [{ role: "user", content: "hi" }], ...extra });
const send = (provider, body) => getExecutor(provider).transformRequest(body.model, body, true, { apiKey: "test-key" });

describe("OpenRouter provider fallback (upstream 9router#2887)", () => {
  it("opts a chat request into provider fallback without mutating the input", () => {
    const body = chat();

    expect(send("openrouter", body).provider).toEqual({ allow_fallbacks: true });
    expect(body).not.toHaveProperty("provider");
  });

  it("merges into the caller's or routing policy's provider preferences", () => {
    const provider = { zdr: true, quantizations: ["fp16"] };

    expect(send("openrouter", chat({ provider })).provider).toEqual({ ...provider, allow_fallbacks: true });
    expect(provider).not.toHaveProperty("allow_fallbacks");
  });

  it("keeps an explicit opt-out", () => {
    expect(send("openrouter", chat({ provider: { allow_fallbacks: false } })).provider).toEqual({ allow_fallbacks: false });
  });

  it.each(["Azure", ["Azure"]])("leaves a non-object provider value alone: %j", (provider) => {
    expect(send("openrouter", chat({ provider })).provider).toEqual(provider);
  });

  it("does not change other providers", () => {
    expect(send("together", chat())).not.toHaveProperty("provider");
  });

  it("already surfaces the upstream provider name for the empty-URL 502", async () => {
    const payload = { error: { message: "Invalid URL: ", code: 502, metadata: { provider_name: "Stealth" } } };

    const parsed = await parseUpstreamError(new Response(JSON.stringify(payload), { status: 502 }), getExecutor("openrouter"));

    expect(parsed.message).toContain("Invalid URL: ");
    expect(parsed.message).toContain("Stealth");
  });
});
