// OmniRoute #21347 port (DurinDoor #2640), dispatch half: a catalog-resolved
// Claude effort reaches the wire under the base model ID, and only as a
// default under explicit request thinking settings. Offline: fetch is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { proxyAwareFetch } = vi.hoisted(() => {
  vi.stubGlobal("fetch", async (url) => { throw new Error(`unexpected fetch: ${url}`); });
  return { proxyAwareFetch: vi.fn() };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch,
}));

const BASE = "claude-haiku-9.9";

async function send(provider, body, modelInfo) {
  proxyAwareFetch.mockResolvedValueOnce(Response.json({
    id: "msg_1", type: "message", role: "assistant", model: BASE, stop_reason: "end_turn",
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
  const request = { model: `${provider}/${BASE}`, max_tokens: 1024, stream: false, messages: [{ role: "user", content: "hi" }], ...body };
  const result = await handleChatCore({
    body: request,
    modelInfo,
    credentials: { apiKey: "sk-test", accessToken: "tok", providerSpecificData: {} },
    connectionId: "effort-variant",
    sourceFormatOverride: FORMATS.CLAUDE,
    clientRawRequest: { endpoint: "/v1/messages", body: request, headers: { accept: "application/json" } },
  });
  expect(result.success, JSON.stringify(result.error ?? null)).toBe(true);
  const [, options] = proxyAwareFetch.mock.calls.at(-1);
  return JSON.parse(options.body);
}

describe("catalog-resolved Claude effort at dispatch", () => {
  beforeEach(() => proxyAwareFetch.mockReset());

  it("sends the base model with the resolved effort", async () => {
    const sent = await send("anthropic", {}, { provider: "anthropic", model: BASE, resolvedThinkingEffort: "high" });
    expect(sent.model).toBe(BASE);
    expect(sent.output_config?.effort).toBe("high");
  });

  it("lets explicit request thinking settings win over the resolved effort", async () => {
    const info = { provider: "anthropic", model: BASE, resolvedThinkingEffort: "high" };
    const explicitEffort = await send("anthropic", { output_config: { effort: "low" } }, info);
    expect(explicitEffort.output_config?.effort).toBe("low");
    const disabled = await send("anthropic", { thinking: { type: "disabled" } }, info);
    expect(disabled.output_config?.effort).toBeUndefined();
  });

  it("adds no effort without a resolved one", async () => {
    const sent = await send("anthropic", {}, { provider: "anthropic", model: BASE });
    expect(sent.output_config?.effort).toBeUndefined();
  });

  it("keeps the provider's own effort restriction", async () => {
    // GitHub Copilot rejects effort on this Claude family; the resolved effort
    // must not bypass that policy, while the wire model is still the base.
    const sent = await send("github", {}, { provider: "github", model: BASE, resolvedThinkingEffort: "high" });
    expect(sent.model).toBe(BASE);
    expect(sent.output_config?.effort).toBeUndefined();
    expect(sent.reasoning_effort).toBeUndefined();
  });
});
