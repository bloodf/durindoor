/**
 * OmniRoute #18673 — the Adapta registry and the executor's key map are two
 * hand-kept lists and the upstream body carries the catalog key, so both are
 * pinned against the real executor with only the network stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptaWebExecutor, MODEL_KEY_MAP } from "../../open-sse/executors/adapta-web.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import provider from "../../open-sse/providers/registry/adapta-web.js";

const LEGACY_IDS = ["adapta-gpt", "adapta-claude", "adapta-gemini", "adapta-grok", "adapta-deepseek", "adapta-llama"];
const TEXT_THEN_FINISH = [
  { type: "text-delta", id: "t1", delta: "hi" },
  { type: "finish" },
  { type: "text-delta", id: "t1", delta: "after the finish" },
];

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Stubs Clerk and the stream endpoint; returns what reached the stream endpoint. */
function stubUpstream(events = TEXT_THEN_FINISH) {
  const bodies = [];
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/client")) return Response.json({ response: { sessions: [{ id: "session-1", status: "active" }] } });
    if (url.endsWith("/tokens")) return Response.json({ jwt: "eyJ.test-session.jwt" });
    expect(url).toBe("https://agent.adapta.one/api/chat/stream/v1");
    bodies.push(JSON.parse(String(init.body)));
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  return bodies;
}

const run = (model, { stream = true, messages = [{ role: "user", content: "hello" }] } = {}) =>
  new AdaptaWebExecutor().execute({
    model, stream, body: { messages }, proxyOptions: { disableEnvProxy: true },
    credentials: { apiKey: `__client=cookie-${model}-${stream}` },
  });

describe("OmniRoute #18673 Adapta catalog model keys", () => {
  it("pairs every registry id with its own catalog key", () => {
    const registryIds = provider.models.map((model) => model.id).sort();
    expect(registryIds).toHaveLength(26);
    expect(registryIds).toEqual(Object.keys(MODEL_KEY_MAP).sort());
    expect(new Set(Object.values(MODEL_KEY_MAP)).size).toBe(registryIds.length);
  });

  it("keeps the pre-catalog ids routable as aliases of adapta-one", () => {
    for (const id of LEGACY_IDS) {
      expect(provider.models.some((model) => model.id === id)).toBe(false);
      expect(getModelUpstreamId("adp-web", id)).toBe("adapta-one");
    }
    expect(getModelUpstreamId("adp-web", "adapta-claude-5-5-sonnet")).toBe("adapta-claude-5-5-sonnet");
  });

  it("sends a permitted non-default model's key in modelAi with the chat ids", async () => {
    const bodies = stubUpstream();
    const result = await run("adapta-claude-5-5-sonnet", { messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "assistant", content: "   " },
      { role: "user", content: "again" },
    ] });
    await result.response.text();

    const [body] = bodies;
    expect(body).toMatchObject({ modelAi: "CLAUDE_5_5_SONNET", trigger: "submit-message", isTemporaryChat: false,
      mandatoryTools: [], skipImagePromptOptimization: true });
    expect(body.id).toBe(body.chatId);
    expect(body).not.toHaveProperty("aiModelId");
    expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(new Set(body.messages.map((message) => message.id)).size).toBe(3);
    expect(body.messages[0].parts).toEqual([{ type: "text", text: "sys\n\nhello" }]);
    expect(body.messages[1]).toMatchObject({ state: "done", metadata: { model: "CLAUDE_5_5_SONNET", chatId: body.chatId,
      messageId: body.messages[1].id, isPaused: false } });
  });

  it.each([...LEGACY_IDS, "adapta-one", "adapta-not-a-model", "constructor"])("sends ONE for %s", async (model) => {
    const bodies = stubUpstream();
    await (await run(model)).response.text();
    expect(bodies[0].modelAi).toBe("ONE");
  });

  it.each([true, false])("ends at the finish event (stream=%s)", async (stream) => {
    stubUpstream();
    const result = await run("adapta-one", { stream });
    const text = await result.response.text();
    expect(text).toContain("hi");
    expect(text).not.toContain("after the finish");
  });
});
