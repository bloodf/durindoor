/**
 * Namespace tool names are sanitized (dots -> "__") on the request side for
 * providers that reject dotted function names, and restored on the response
 * side. Providers can also inject prefixes the client never declared (e.g.
 * `functions.exec` for a plain declared `exec` tool); the response side
 * canonicalizes those against the request's own declared tool names.
 */
import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

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

describe("Responses tool-name sanitization + restoration (#4200)", () => {
  it("sanitizes a dotted namespace tool name to '__' on the request and maps it back", () => {
    const out = openaiResponsesToOpenAIRequest("m", {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "spawn a helper" }] }],
      tools: [COLLAB_NAMESPACE],
    }, true, null);

    expect(out.tools.map((t) => t.function.name)).toEqual(["collaboration__spawn_agent"]);
    expect(out._toolNameMap.get("collaboration__spawn_agent")).toBe("collaboration.spawn_agent");
  });

  it("leaves flat (undotted) tool names untouched and produces no map", () => {
    const out = openaiResponsesToOpenAIRequest("m", {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{ type: "function", name: "get_weather", parameters: { type: "object" } }],
    }, true, null);

    expect(out.tools.map((t) => t.function.name)).toEqual(["get_weather"]);
    expect(out._toolNameMap).toBeUndefined();
  });

  it("restores a sanitized namespace tool call back to name + namespace via the toolNameMap", async () => {
    const body = { tools: [COLLAB_NAMESPACE] };
    const toolNameMap = new Map([["collaboration__spawn_agent", "collaboration.spawn_agent"]]);

    const text = await translateOpenAIStream(body, body, [
      {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "collaboration__spawn_agent", arguments: "{}" } }] },
          finish_reason: "tool_calls",
        }],
      },
    ], toolNameMap);

    const added = parseSseEvents(text).find((e) => e.type === "response.output_item.added");
    expect(added.item.name).toBe("spawn_agent");
    expect(added.item.namespace).toBe("collaboration");
  });

  it("canonicalizes a provider-injected prefix (functions.exec) against a declared plain tool", async () => {
    const body = { tools: [{ type: "function", name: "exec" }] };

    const text = await translateOpenAIStream(body, body, [
      {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "functions.exec", arguments: "{}" } }] },
          finish_reason: "tool_calls",
        }],
      },
    ]);

    const added = parseSseEvents(text).find((e) => e.type === "response.output_item.added");
    expect(added.item.name).toBe("exec");
    expect(added.item.namespace).toBeUndefined();
  });

  it("forwards a bare declared namespace name (no sub-tool) unchanged", async () => {
    const body = { tools: [COLLAB_NAMESPACE] };

    const text = await translateOpenAIStream(body, body, [
      {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "collaboration", arguments: "{}" } }] },
          finish_reason: "tool_calls",
        }],
      },
    ]);

    const added = parseSseEvents(text).find((e) => e.type === "response.output_item.added");
    expect(added.item.name).toBe("collaboration");
    expect(added.item.namespace).toBeUndefined();
  });

  it("forwards a fully undeclared dotted tool name unchanged", async () => {
    const body = { tools: [{ type: "function", name: "exec" }] };

    const text = await translateOpenAIStream(body, body, [
      {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "unknown.thing", arguments: "{}" } }] },
          finish_reason: "tool_calls",
        }],
      },
    ]);

    const added = parseSseEvents(text).find((e) => e.type === "response.output_item.added");
    expect(added.item.name).toBe("unknown.thing");
    expect(added.item.namespace).toBeUndefined();
  });
});
