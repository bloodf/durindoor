// #1433: review follow-ups for #1429 (stream tool-call ids), #1430 (Chat alias
// restore) and #1431 (combo request-scoped 4xx).
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const { ensureStreamToolCallIds } = await import("../../open-sse/utils/streamHelpers.js");
const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { composeToolNameMaps, normalizeOpenAIToolNames, restoreOpenAIToolNames } = await import("../../open-sse/translator/concerns/toolCall.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleComboChat, resetComboRotation } = await import("../../open-sse/services/combo.js");

async function passthrough(chunks) {
  const stream = createPassthroughStreamWithLogger("openai", null, null, "gpt-4.1", "conn-1", {}, null, "sk-test", FORMATS.OPENAI);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  const readAll = (async () => {
    let output = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return output;
      output += decoder.decode(value);
    }
  })();
  await writer.write(new TextEncoder().encode(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")));
  await writer.close();
  return (await readAll).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
}

describe("#1433 stream tool-call ids", () => {
  it("gives two choices that open the same index in one chunk distinct ids", () => {
    const chunk = { choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { name: "a" } }] } },
      { index: 1, delta: { tool_calls: [{ index: 0, function: { name: "b" } }] } },
    ] };
    ensureStreamToolCallIds(chunk, new Set());
    const [a, b] = chunk.choices.map((choice) => choice.delta.tool_calls[0].id);
    expect(a).toMatch(/^call_0_0_/);
    expect(b).toMatch(/^call_1_0_/);
    expect(a).not.toBe(b);
  });

  it("does not mark a tool call opened by a chunk the passthrough drops", async () => {
    const events = await passthrough([
      { id: "chatcmpl-12345678", choices: [{ index: 0, delta: { content: "x" }, finish_reason: "stop" }] },
      // Duplicate finish for choice 0: dropped before it reaches the client.
      { id: "chatcmpl-12345678", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "late" } }] }, finish_reason: "stop" }] },
      { id: "chatcmpl-12345678", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "next" } }] }, finish_reason: null }] },
    ]);
    const calls = events.flatMap((event) => event.choices || []).flatMap((choice) => choice.delta?.tool_calls || []);
    expect(calls.map((call) => call.function.name)).toEqual(["next"]);
    // The first fragment the client actually sees for this index carries an id.
    expect(calls[0].id).toMatch(/^call_0_0_/);
  });
});

describe("#1433 Chat tool-name alias maps", () => {
  const original = `mcp.server/${"very-long-tool-name-".repeat(5)}end`;

  it("restores a name aliased by the translator and again by chatCore's toolNameMaxLength", () => {
    const body = { tools: [{ type: "function", function: { name: original, parameters: { type: "object" } } }] };
    const translatorMap = normalizeOpenAIToolNames(body);
    const firstAlias = body.tools[0].function.name;
    const chatCoreMap = normalizeOpenAIToolNames(body, 24);
    const secondAlias = body.tools[0].function.name;
    expect(firstAlias).not.toBe(original);
    expect(secondAlias).not.toBe(firstAlias);
    expect(secondAlias.length).toBeLessThanOrEqual(24);

    const composed = composeToolNameMaps(translatorMap, chatCoreMap);
    const response = { choices: [{ message: { tool_calls: [{ function: { name: secondAlias } }] } }] };
    restoreOpenAIToolNames(response, composed);
    expect(response.choices[0].message.tool_calls[0].function.name).toBe(original);
  });

  it("restores aliases on the ordinary non-stream Chat path", async () => {
    const completion = {
      id: "chatcmpl-abc", object: "chat.completion", created: 1, model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "alias_1", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const result = await handleNonStreamingResponse({
      providerResponse: {
        headers: new Map([["content-type", "application/json"]]),
        text: () => Promise.resolve(JSON.stringify(completion)),
        json: () => Promise.resolve(structuredClone(completion)),
        status: 200,
        statusText: "OK",
      },
      provider: "openai",
      model: "m",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: "m", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: new Map([["alias_1", "mcp.files/read"]]),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });
    const json = await result.response.json();
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("mcp.files/read");
  });
});

describe("#1433 combo keeps a transient retry hint over a request-scoped rejection", () => {
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns the retryable failure with Retry-After when another member asked to retry", async () => {
    resetComboRotation();
    const retryAfter = new Date(Date.now() + 60_000).toISOString();
    const response = await handleComboChat({
      body: { model: "combo", stream: false, messages: [{ role: "user", content: "hi" }] },
      models: ["p1/first", "p2/second"],
      handleSingleModel: async (_body, model) => model === "p1/first" ?
        json(400, { error: { message: "unsupported parameter" } }) :
        json(429, { error: { message: "rate limited" }, retryAfter }),
      log,
      comboName: "retry-hint-test",
      comboStrategy: "fallback",
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
