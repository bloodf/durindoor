/**
 * Dotted namespace tool names are aliased for OpenAI-format providers by
 * chatCore's normalizeOpenAIToolNames and restored on the response side through
 * toolNameMap. Providers can also inject prefixes the client never declared (e.g.
 * `functions.exec` for a plain declared `exec` tool); the response side
 * canonicalizes those against the request's own declared tool names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { normalizeOpenAIToolNames } from "../../open-sse/translator/concerns/toolCall.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { resolveResponsesToolName } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

function encodeChunks(...chunks) {
  return chunks
    .map((c) => `data: ${JSON.stringify(c)}`)
    .concat(["", "data: [DONE]", ""])
    .join("\n");
}

async function translateOpenAIStream(body, providerBody, payloads, toolNameMap = null) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(encodeChunks(...payloads)));
      controller.close();
    },
  });

  const output = stream.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.OPENAI_RESPONSES,
    "test",
    null,
    toolNameMap,
    "test-model",
    null,
    body,
    null,
    null,
    "off",
    null,
    providerBody,
  ));
  const reader = output.getReader();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseSseEvents(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload));
}

const COLLAB_NAMESPACE = {
  type: "namespace",
  name: "collaboration",
  description: "collaboration tools",
  tools: [{ name: "spawn_agent", description: "spawn a subagent" }],
};

const userInput = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];

const toolCallChunk = (name) => ({
  choices: [{
    index: 0,
    delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "{}" } }] },
    finish_reason: "tool_calls",
  }],
});

async function streamedItems(body, name, toolNameMap = null) {
  const events = parseSseEvents(await translateOpenAIStream(body, body, [toolCallChunk(name)], toolNameMap));
  return {
    added: events.find((e) => e.type === "response.output_item.added")?.item,
    done: events.find((e) => e.type === "response.output_item.done")?.item,
  };
}

/** Mirror chatCore: Responses -> Chat translation, then OpenAI-name aliasing. */
function translateForOpenAIProvider(body) {
  const translated = openaiResponsesToOpenAIRequest("m", { input: userInput, ...body }, true, null);
  const aliases = normalizeOpenAIToolNames(translated);
  return { translated, aliases };
}

afterEach(() => vi.restoreAllMocks());

describe("Responses tool-name aliasing + restoration (#4200)", () => {
  it("keeps the dotted namespace name in the Chat translation (aliasing happens in chatCore)", () => {
    const out = openaiResponsesToOpenAIRequest("m", { input: userInput, tools: [COLLAB_NAMESPACE] }, true, null);
    expect(out.tools.map((t) => t.function.name)).toEqual(["collaboration.spawn_agent"]);
    expect(out._toolNameMap).toBeUndefined();
  });

  it("aliases dotted names without colliding with a declared `__` name", () => {
    const { translated, aliases } = translateForOpenAIProvider({
      tools: [COLLAB_NAMESPACE, { type: "function", name: "collaboration__spawn_agent", parameters: { type: "object" } }],
    });
    const names = translated.tools.map((t) => t.function.name);
    expect(new Set(names).size).toBe(2);
    expect(names[1]).toBe("collaboration__spawn_agent");
    expect(aliases.get(names[0])).toBe("collaboration.spawn_agent");
    expect(aliases.has("collaboration__spawn_agent")).toBe(false);
  });

  it("gives history and tool_choice the same alias as the declaration", () => {
    const { translated } = translateForOpenAIProvider({
      input: [
        ...userInput,
        { type: "function_call", call_id: "c1", name: "collaboration.spawn_agent", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
      tools: [COLLAB_NAMESPACE],
      tool_choice: { type: "function", name: "collaboration.spawn_agent" },
    });
    const declared = translated.tools[0].function.name;
    const historyCall = translated.messages.flatMap((m) => m.tool_calls || [])[0];
    expect(declared).not.toContain(".");
    expect(historyCall.function.name).toBe(declared);
    const choiceName = translated.tool_choice?.function?.name ?? translated.tool_choice?.name;
    expect(choiceName).toBe(declared);
  });

  it("restores an aliased namespace call back to name + namespace (stream)", async () => {
    const body = { tools: [COLLAB_NAMESPACE] };
    const { translated, aliases } = translateForOpenAIProvider(body);
    const { added, done } = await streamedItems(body, translated.tools[0].function.name, aliases);
    for (const item of [added, done]) {
      expect(item.name).toBe("spawn_agent");
      expect(item.namespace).toBe("collaboration");
    }
  });

  it("restores an aliased namespace call back to name + namespace (non-stream)", () => {
    const body = { tools: [COLLAB_NAMESPACE] };
    const { translated, aliases } = translateForOpenAIProvider(body);
    const completion = {
      id: "x",
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [
        { id: "call_1", type: "function", function: { name: translated.tools[0].function.name, arguments: "{}" } },
      ] } }],
    };
    const out = translateNonStreamingResponse(completion, "openai", "openai-responses", { toolNameMap: aliases, requestBody: body });
    const call = out.output.find((item) => item.type === "function_call");
    expect(call.name).toBe("spawn_agent");
    expect(call.namespace).toBe("collaboration");
  });

  it("restores an aliased namespace call on the forced SSE-to-JSON route", async () => {
    const body = { tools: [COLLAB_NAMESPACE] };
    const { translated, aliases } = translateForOpenAIProvider(body);
    const raw = [
      `data: ${JSON.stringify(toolCallChunk(translated.tools[0].function.name))}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      provider: "openai",
      model: "m",
      body,
      stream: true,
      toolNameMap: aliases,
      requestStartTime: Date.now(),
      connectionId: "c",
      clientRawRequest: { endpoint: "/v1/responses" },
      onRequestSuccess: vi.fn(async () => {}),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      log: { line: vi.fn(), debug: vi.fn() },
      usageEventId: "e",
      terminalProvenance: "upstream",
    });
    expect(result.success).toBe(true);
    const call = (await result.response.json()).output.find((item) => item.type === "function_call");
    expect(call).toMatchObject({ name: "spawn_agent", namespace: "collaboration" });
  });

  it("keeps a dotted custom tool a custom_tool_call after aliasing", async () => {
    const body = { tools: [{ type: "custom", name: "fs.apply_patch", description: "patch" }] };
    const { translated, aliases } = translateForOpenAIProvider(body);
    const alias = translated.tools[0].function.name;
    const { done } = await streamedItems(body, alias, aliases);
    expect(done.type).toBe("custom_tool_call");
    expect(done.name).toBe("fs.apply_patch");

    const completion = {
      id: "x",
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [
        { id: "call_1", type: "function", function: { name: alias, arguments: "{\"input\":\"p\"}" } },
      ] } }],
    };
    const out = translateNonStreamingResponse(completion, "openai", "openai-responses", {
      toolNameMap: aliases, requestBody: body, customToolNames: translated._customToolNames,
    });
    expect(out.output[0]).toMatchObject({ type: "custom_tool_call", name: "fs.apply_patch", input: "p" });
  });

  it("canonicalizes a provider-injected prefix (functions.exec) against a declared plain tool", async () => {
    const { added } = await streamedItems({ tools: [{ type: "function", name: "exec" }] }, "functions.exec");
    expect(added.name).toBe("exec");
    expect(added.namespace).toBeUndefined();
  });

  it("keeps the namespace when a provider prefixes a declared namespace subtool", async () => {
    const { added } = await streamedItems({ tools: [COLLAB_NAMESPACE] }, "functions.spawn_agent");
    expect(added.name).toBe("spawn_agent");
    expect(added.namespace).toBe("collaboration");
  });

  it("does not bind a dotted call to a shorter declared suffix", async () => {
    const { added } = await streamedItems({ tools: [{ type: "function", name: "rm" }] }, "do.not.rm");
    expect(added.name).toBe("do.not.rm");
    expect(added.namespace).toBeUndefined();
  });

  it("warns once and forwards a bare declared namespace name unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { added } = await streamedItems({ tools: [COLLAB_NAMESPACE] }, "collaboration");
    expect(added.name).toBe("collaboration");
    expect(added.namespace).toBeUndefined();
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes("bare namespace"))).toHaveLength(1);
  });

  it("forwards a fully undeclared dotted tool name unchanged", async () => {
    const { added } = await streamedItems({ tools: [{ type: "function", name: "exec" }] }, "unknown.thing");
    expect(added.name).toBe("unknown.thing");
    expect(added.namespace).toBeUndefined();
  });

  it("restores an aliased name behind a provider-injected prefix", async () => {
    const body = { tools: [COLLAB_NAMESPACE] };
    const { translated, aliases } = translateForOpenAIProvider(body);
    const { added, done } = await streamedItems(body, `functions.${translated.tools[0].function.name}`, aliases);
    for (const item of [added, done]) {
      expect(item).toMatchObject({ name: "spawn_agent", namespace: "collaboration" });
    }
  });

  it("restores the namespace on Gemini-family stream:false responses", () => {
    const body = { tools: [COLLAB_NAMESPACE] };
    const gemini = { candidates: [{ content: { parts: [{ functionCall: { id: "call_1", name: "collaboration.spawn_agent", args: {} } }] }, finishReason: "STOP" }] };
    const out = translateNonStreamingResponse(gemini, FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES, { requestBody: body });
    const call = out.output.find((item) => item.type === "function_call");
    expect(call).toMatchObject({ name: "spawn_agent", namespace: "collaboration" });
  });

  it("frames a prefixed declared custom tool as custom_tool_call in the stream", async () => {
    const body = { tools: [{ type: "custom", name: "apply_patch", description: "patch" }] };
    const { added, done } = await streamedItems(body, "functions.apply_patch");
    for (const item of [added, done]) {
      expect(item).toMatchObject({ type: "custom_tool_call", name: "apply_patch" });
    }
  });

  it("re-qualifies a replayed { name, namespace } call so history matches the declaration", () => {
    const { translated } = translateForOpenAIProvider({
      input: [
        ...userInput,
        { type: "function_call", call_id: "c1", name: "spawn_agent", namespace: "collaboration", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
      tools: [COLLAB_NAMESPACE],
    });
    const historyCall = translated.messages.flatMap((m) => m.tool_calls || [])[0];
    expect(historyCall.function.name).toBe(translated.tools[0].function.name);
  });

  it("forwards a non-string provider name without throwing", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES, { tools: [COLLAB_NAMESPACE] });
    expect(resolveResponsesToolName(state, 42)).toEqual({ name: 42 });
    expect(resolveResponsesToolName(state, undefined)).toEqual({ name: undefined });
  });
});
