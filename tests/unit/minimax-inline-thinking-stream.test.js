import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();

async function runPassthrough({ provider, model, frames }) {
  const sse = `${frames.map(frame => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
  const transformed = input.pipeThrough(createPassthroughStreamWithLogger(
    provider,
    null,
    null,
    model,
    null,
    { model, messages: [{ role: "user", content: "hello" }] },
    null,
    null,
    FORMATS.OPENAI,
  ));
  return new Response(transformed).text();
}

function dataObjects(sse) {
  return sse.split("\n")
    .filter(line => line.startsWith("data:") && line.slice(5).trim() !== "[DONE]")
    .map(line => JSON.parse(line.slice(5).trim()));
}

function collectChoiceDeltas(objects, index) {
  const deltas = objects
    .flatMap(object => object.choices || [])
    .filter(choice => choice.index === index)
    .map(choice => choice.delta || {});
  return {
    content: deltas.map(delta => delta.content || "").join(""),
    reasoning: deltas.map(delta => delta.reasoning_content || "").join(""),
  };
}

describe("MiniMax passthrough streaming inline thinking", () => {
  it("emits balanced reasoning and answer before the finish frame", async () => {
    const transform = createPassthroughStreamWithLogger(
      "minimax",
      null,
      null,
      "MiniMax-M3",
      null,
      { model: "MiniMax-M3", messages: [{ role: "user", content: "hello" }] },
      null,
      null,
      FORMATS.OPENAI,
    );
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const writeAndRead = async (frame) => {
      const write = writer.write(encoder.encode(`data: ${JSON.stringify(frame)}\n`));
      const read = reader.read();
      const [, result] = await Promise.all([write, read]);
      return new TextDecoder().decode(result.value);
    };

    const live = await writeAndRead({
      id: "chunk-live",
      object: "chat.completion.chunk",
      created: 1,
      model: "MiniMax-M3",
      choices: [{ index: 0, delta: { content: "<think>live reasoning</think>live answer" }, finish_reason: null }],
    });
    expect(collectChoiceDeltas(dataObjects(live), 0)).toEqual({
      content: "live answer",
      reasoning: "live reasoning",
    });
    expect(live).not.toContain("finish_reason\":\"stop");

    await writeAndRead({
      id: "chunk-live",
      object: "chat.completion.chunk",
      created: 1,
      model: "MiniMax-M3",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    const doneWrite = writer.write(encoder.encode("data: [DONE]\n"));
    const doneRead = reader.read();
    const [, doneResult] = await Promise.all([doneWrite, doneRead]);
    expect(new TextDecoder().decode(doneResult.value)).toContain("data: [DONE]");
    const close = writer.close();
    const terminal = await reader.read();
    await close;
    expect(terminal.done).toBe(true);
  });

  it("activates extraction through the production streaming handler", async () => {
    const frames = [
      { id: "chunk-handler", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>wrapped</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-handler", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const sse = `${frames.map(frame => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
    const streamController = {
      signal: new AbortController().signal,
      isConnected: vi.fn(() => true),
      handleComplete: vi.fn(),
      handleDisconnect: vi.fn(),
      handleError: vi.fn(),
      abort: vi.fn(),
    };
    const result = await handleStreamingResponse({
      providerResponse: new Response(sse, { headers: { "content-type": "text/event-stream" } }),
      provider: "minimax",
      model: "MiniMax-M3",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { model: "MiniMax-M3", messages: [{ role: "user", content: "hello" }] },
      stream: true,
      requestStartTime: Date.now(),
      clientRawRequest: {},
      streamController,
      streamDetailId: "stream-handler-test",
    });

    expect(result.success).toBe(true);
    const output = await result.response.text();
    expect(collectChoiceDeltas(dataObjects(output), 0)).toEqual({
      content: "answer",
      reasoning: "wrapped",
    });
    expect(output).not.toContain("<think>");
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(streamController.handleComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps split tag state isolated for every choice", async () => {
    const frames = [
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { role: "assistant", content: "<thi" }, finish_reason: null },
        { index: 1, delta: { role: "assistant", content: "<think>one" }, finish_reason: null },
      ] },
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 1, delta: { content: " reason</think>one answer" }, finish_reason: null },
        { index: 0, delta: { content: "nk>zero reason</thi" }, finish_reason: null },
      ] },
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "nk>zero answer" }, finish_reason: null },
      ] },
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
        { index: 1, delta: {}, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
    ];
    const output = await runPassthrough({ provider: "minimax-cn", model: "MiniMax-M3", frames });
    const objects = dataObjects(output);

    expect(collectChoiceDeltas(objects, 0)).toEqual({ content: "zero answer", reasoning: "zero reason" });
    expect(collectChoiceDeltas(objects, 1)).toEqual({ content: "one answer", reasoning: "one reason" });
    expect(output).not.toContain("<think>");
  });

  it("keeps a tagged later choice when the first choice delta is empty", async () => {
    const frames = [
      { id: "chunk-later-choice", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: null },
        { index: 1, delta: { content: "<think>later reasoning</think>later answer" }, finish_reason: null },
      ] },
      { id: "chunk-later-choice", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
        { index: 1, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 1)).toEqual({
      content: "later answer",
      reasoning: "later reasoning",
    });
  });

  it("preserves reasoning separators across chunks and choices", async () => {
    const frames = [
      { id: "chunk-separators", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { reasoning_content: "native" }, finish_reason: null },
        { index: 1, delta: { content: "<think>first</think>between" }, finish_reason: null },
      ] },
      { id: "chunk-separators", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>tag" }, finish_reason: null },
        { index: 1, delta: { content: "<think>second</think>reply" }, finish_reason: null },
      ] },
      { id: "chunk-separators", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "ged</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-separators", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
        { index: 1, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    const objects = dataObjects(output);

    expect(collectChoiceDeltas(objects, 0)).toEqual({ content: "answer", reasoning: "native\ntagged" });
    expect(collectChoiceDeltas(objects, 1)).toEqual({ content: "betweenreply", reasoning: "first\nsecond" });
  });

  it("does not duplicate an existing trailing reasoning newline", async () => {
    const frames = [
      { id: "chunk-newline", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { reasoning_content: "native\n" }, finish_reason: null },
      ] },
      { id: "chunk-newline", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>tagged</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-newline", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 0).reasoning).toBe("native\ntagged");
  });

  it("preserves tagged-before-native reasoning order", async () => {
    const frames = [
      { id: "chunk-order", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>tagged</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-order", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { reasoning_content: "native" }, finish_reason: null },
      ] },
      { id: "chunk-order", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 0)).toEqual({
      content: "answer",
      reasoning: "tagged\nnative",
    });
  });

  it("fails open when structured native reasoning arrives during a tag", async () => {
    const structuredReasoning = { blocks: ["native"] };
    const frames = [
      { id: "chunk-structured", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "before<think>part" }, finish_reason: null },
      ] },
      { id: "chunk-structured", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "ial</think>after", reasoning_content: structuredReasoning }, finish_reason: null },
      ] },
      { id: "chunk-structured", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>later</think>tail" }, finish_reason: null },
      ] },
      { id: "chunk-structured", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    const objects = dataObjects(output);

    expect(collectChoiceDeltas(objects, 0).content).toBe(
      "before<think>partial</think>after<think>later</think>tail",
    );
    const structuredValues = objects
      .flatMap(object => object.choices || [])
      .filter(choice => choice.index === 0)
      .map(choice => choice.delta?.reasoning_content)
      .filter(value => value && typeof value === "object");
    expect(structuredValues).toEqual([structuredReasoning]);
  });

  it.each([
    ["one frame", ["before<think>valid</think></think>after"], "before<think>valid</think></think>after"],
    ["a pending cross-frame transaction", ["before<think>valid</thi", "nk></think>after"], "before<think>valid</think></think>after"],
  ])("fails open byte-for-byte for a completed tag followed by a stray close in %s", async (_label, contents, expected) => {
    const frames = contents.map(content => ({
      id: "chunk-malformed",
      object: "chat.completion.chunk",
      created: 1,
      model: "MiniMax-M3",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    }));
    frames.push({
      id: "chunk-malformed",
      object: "chat.completion.chunk",
      created: 1,
      model: "MiniMax-M3",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 0)).toEqual({
      content: expected,
      reasoning: "",
    });
  });

  it("keeps later malformed bytes visible after a balanced segment was emitted", async () => {
    const frames = [
      { id: "chunk-late-malformed", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "before<think>valid</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-late-malformed", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "</think>after" }, finish_reason: null },
      ] },
      { id: "chunk-late-malformed", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 0)).toEqual({
      content: "beforeanswer</think>after",
      reasoning: "valid",
    });
  });

  it("leaves literal tags untouched for an unrelated provider", async () => {
    const frames = [
      { id: "chunk-literal", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>visible</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-literal", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "galadriel", model: "MiniMax-M3", frames });
    const choice = collectChoiceDeltas(dataObjects(output), 0);
    expect(choice).toEqual({ content: "<think>visible</think>answer", reasoning: "" });
  });

  it("restores an unclosed segment as visible content before terminal", async () => {
    const frames = [
      { id: "chunk-open", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "before<think>unfinished" }, finish_reason: null },
      ] },
      { id: "chunk-open", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 0)).toEqual({
      content: "before<think>unfinished",
      reasoning: "",
    });
  });
});
