import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const world = vi.hoisted(() => ({ mode: "ok", starts: [] }));
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { CloudflarePlaygroundExecutor } = await import("../../open-sse/executors/cloudflare-playground.js");
  class MockTransport {
    constructor(id) { this.id = id; }
    async start(config) { world.starts.push(config); return { ok: true }; }
    async *frames() {
      if (world.mode === "quota") {
        yield JSON.stringify({ id: this.id, type: "cf_agent_use_chat_response", error: true, body: JSON.stringify({ details: "rate limit reached" }) });
      } else if (world.mode === "upstream") {
        yield JSON.stringify({ id: this.id, type: "cf_agent_use_chat_response", error: true, body: JSON.stringify({ details: "temporary upstream failure" }) });
      } else {
        const delta = world.mode === "tool" ? '{"name":"read","arguments":{"path":"package.json"}}' : "hello";
        yield JSON.stringify({ id: this.id, type: "cf_agent_use_chat_response", body: JSON.stringify({ type: "text-delta", delta }) });
        yield JSON.stringify({ id: this.id, type: "cf_agent_use_chat_response", done: true, body: "{}" });
      }
    }
    async close() {}
  }
  const executor = new CloudflarePlaygroundExecutor((id) => new MockTransport(id));
  return { ...original, getExecutor: (id) => id === "cloudflare-playground" || id === "cfp" ? executor : original.getExecutor(id) };
});
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import provider from "../../open-sse/providers/registry/cloudflare-playground.js";
import { cloudflareErrorStatus, hasCloudflareUnsupportedImage, toCloudflareMessages } from "../../open-sse/executors/cloudflare-playground.js";

const MODEL = "zai-org/glm-5.2";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function chat(endpoint, body) {
  return handleChatCore({ body, modelInfo: { provider: "cloudflare-playground", model: body.model },
    credentials: { authType: "none", id: "cf-public" }, clientRawRequest: { endpoint, body, headers: {} },
    sourceFormatOverride: endpoint === "/v1/messages" ? FORMATS.CLAUDE : FORMATS.OPENAI, connectionId: "cf-public", log,
    rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
}

describe("staged Cloudflare Playground provider", () => {
  afterEach(() => { world.mode = "ok"; world.starts.length = 0; });

  it("composes as anonymous and converts OpenAI messages to the upstream text shape", () => {
    expect(REGISTRY.find((entry) => entry.id === provider.id)).toBe(provider);
    expect(provider).toMatchObject({ authType: "none", noAuth: true });
    expect(toCloudflareMessages([{ role: "system", content: "ignored" }, { role: "user", content: "hello" }])).toEqual([
      { role: "user", parts: [{ type: "text", text: "hello" }], id: "m1" },
    ]);
    expect(cloudflareErrorStatus("rate limit exceeded")).toBe(429);
    expect(hasCloudflareUnsupportedImage([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }])).toBe(true);
  });

  it.each(["/v1/chat/completions", "/v1/messages"])("serves JSON and streamed chat over %s without a key", async (endpoint) => {
    const body = endpoint === "/v1/messages" ? { model: MODEL, max_tokens: 80, messages: [{ role: "user", content: "hi" }] } : { model: MODEL, messages: [{ role: "user", content: "hi" }] };
    const result = await chat(endpoint, body);
    const json = await result.response.json();
    expect(endpoint === "/v1/messages" ? json.content[0].text : json.choices[0].message.content).toBe("hello");
    expect(world.starts[0].model).toBe(MODEL);
    const streaming = await chat(endpoint, { ...body, stream: true });
    expect(await streaming.response.text()).toContain("hello");
  });

  it.each(["/v1/chat/completions", "/v1/messages"])("OmniRoute #18313 returns an emulated tool call over %s, JSON and streamed", async (endpoint) => {
    world.mode = "tool";
    const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
    const claude = endpoint === "/v1/messages";
    const tools = claude ? [{ name: "read", input_schema: schema }] : [{ type: "function", function: { name: "read", parameters: schema } }];
    const body = { model: MODEL, max_tokens: 80, messages: [{ role: "user", content: "read it" }], tools };
    const json = await (await chat(endpoint, body)).response.json();
    expect(world.starts[0].messages[0].parts[0].text).toContain("- read({path: string})");
    if (claude) {
      expect(json.stop_reason).toBe("tool_use");
      expect(json.content.find((block) => block.type === "tool_use")).toMatchObject({ name: "read", input: { path: "package.json" } });
    } else {
      expect(json.choices[0].finish_reason).toBe("tool_calls");
      expect(json.choices[0].message.tool_calls[0].function).toEqual({ name: "read", arguments: '{"path":"package.json"}' });
    }
    const sse = await (await chat(endpoint, { ...body, stream: true })).response.text();
    expect(sse).toContain(claude ? '"stop_reason":"tool_use"' : '"finish_reason":"tool_calls"');
    // The shared OpenAI-to-Claude stream translator applies Claude Code tool-name casing.
    expect(sse).toMatch(/"name":"read"/i);
    expect(sse).toContain("package.json");
    expect(sse).not.toContain('"error"');
  });

  it("maps anonymous rate limits and other upstream failures to quota and provider errors", async () => {
    world.mode = "quota";
    expect((await chat("/v1/chat/completions", { model: MODEL, messages: [{ role: "user", content: "hi" }] })).response.status).toBe(429);
    world.mode = "upstream";
    expect((await chat("/v1/chat/completions", { model: MODEL, messages: [{ role: "user", content: "hi" }] })).response.status).toBe(502);
  });
});
