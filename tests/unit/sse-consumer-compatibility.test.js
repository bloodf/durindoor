import { describe, expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { mapInteractionEvents } from "../../open-sse/utils/interactionEvents.js";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";

const encoder = new TextEncoder();

function byteStream(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const chatChunk = (content) => JSON.stringify({
  choices: [{ index: 0, delta: { content } }],
});
const completed = (id) => JSON.stringify({
  type: "response.completed",
  response: { id },
});

describe("Responses SSE data parsing", () => {
  it("keeps the first payload when a streaming frame contains separate JSON lines", async () => {
    const wire = `data: ${chatChunk("first")}\ndata: ${chatChunk("second")}\n\n`;
    const output = await new Response(byteStream(wire).pipeThrough(createResponsesApiTransformStream())).text();
    expect(output).toContain('"delta":"first"');
    expect(output).not.toContain('"delta":"second"');
  });

  it("keeps the first payload when a buffered frame contains separate JSON lines", async () => {
    const wire = `data: ${completed("resp_first")}\ndata: ${completed("resp_second")}\n\n`;
    await expect(convertResponsesStreamToJson(byteStream(wire))).resolves.toMatchObject({
      id: "resp_first",
      status: "completed",
    });
  });

  it("skips malformed streaming data and still emits a subsequent joined JSON frame", async () => {
    const wire = `data: {bad\ndata: ${chatChunk("ignored")}\n\n` +
      'data: {"choices":\ndata: [{"delta":{"content":"joined"}}]}\n\n';
    const output = await new Response(byteStream(wire).pipeThrough(createResponsesApiTransformStream())).text();
    expect(output).toContain('"delta":"joined"');
    expect(output).not.toContain('"delta":"ignored"');
  });

  it("accepts joined buffered JSON and reports malformed data as failed", async () => {
    const wire = 'data: {"type":"response.completed",\ndata: "response":{"id":"resp_joined"}}\n\n';
    await expect(convertResponsesStreamToJson(byteStream(wire))).resolves.toMatchObject({
      id: "resp_joined",
      status: "completed",
    });
    await expect(convertResponsesStreamToJson(byteStream(`data: {bad\ndata: ${completed("resp_ignored")}\n\n`)))
      .resolves.toMatchObject({ status: "failed" });
  });
});

it("delivers an Ollama chunk while the upstream SSE stream is still open without a blank separator", async () => {
  let upstream;
  const body = new ReadableStream({ start(controller) { upstream = controller; } });
  const reader = transformToOllama(new Response(body), "test").body.getReader();
  let timer;
  try {
    upstream.enqueue(encoder.encode(`data: ${chatChunk("early")}\r\n`));
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Ollama chunk waited for a blank separator")), 500);
    });
    const { value } = await Promise.race([reader.read(), timeout]);
    expect(JSON.parse(new TextDecoder().decode(value))).toMatchObject({
      message: { content: "early" },
      done: false,
    });

    upstream.enqueue(encoder.encode("data: [DONE]\n"));
    const terminal = await Promise.race([reader.read(), timeout]);
    expect(JSON.parse(new TextDecoder().decode(terminal.value))).toMatchObject({ done: true });

    upstream.close();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  } finally {
    clearTimeout(timer);
    await reader.cancel();
  }
});

it("decodes a joined Ollama SSE payload across CRLF and byte chunk boundaries", async () => {
  const body = byteStream(
    ': comment\r\ndata: {"choices":\r',
    '\ndata: [{"delta":{"content":"joined"}}]}\r\n\r',
    '\ndata: [DONE]\r\n',
  );
  const output = await transformToOllama(new Response(body), "test").text();
  expect(output.trim().split("\n").map((line) => JSON.parse(line))).toMatchObject([
    { message: { content: "joined" }, done: false },
    { done: true },
  ]);
});

describe("interaction SSE pending limit", () => {
  const limit = 1024 * 1024;
  const prefix = 'data: {"value":"';
  const suffix = '"}';
  const pending = prefix + "é".repeat(limit - prefix.length - suffix.length) + suffix;

  it("allows 1,048,576 pending UTF-16 code units and a larger complete frame", async () => {
    const output = mapInteractionEvents(
      byteStream(pending, "\n\n", pending + " ".repeat(8) + "\n\n"),
      ({ value }) => `${value.length}\n`,
    );
    await expect(new Response(output).text()).resolves.toBe(
      `${limit - prefix.length - suffix.length}\n`.repeat(2),
    );
  });

  it("rejects an unterminated remainder over the limit with the interaction-specific error", async () => {
    const output = mapInteractionEvents(byteStream(pending, " "), () => "unexpected");
    await expect(new Response(output).text()).rejects.toThrow("Interactions SSE frame exceeds size limit");
  });
});
