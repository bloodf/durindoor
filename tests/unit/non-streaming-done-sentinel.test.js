import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();
const completed = [
  "event: response.completed",
  `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
  "",
  "",
].join("\n");

async function transformResponses(mode, body, input = completed) {
  const stream = createSSEStream({
    mode,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    body,
  });
  const response = new Response(stream.readable);
  const output = response.text();
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode(input));
  await writer.close();
  return output;
}
async function transformOpenAI(body, includeDone = false) {
  const terminal = `data: ${JSON.stringify({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n${includeDone ? "data: [DONE]\n\n" : ""}`;
  const stream = createSSEStream({
    mode: "passthrough",
    targetFormat: FORMATS.OPENAI,
    body,
  });
  const response = new Response(stream.readable);
  const output = response.text();
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode(terminal));
  await writer.close();
  return output;
}

function doneCount(output) {
  return output.match(/^data: \[DONE\]$/gm)?.length || 0;
}

describe("Responses API DONE sentinel", () => {
  it.each(["translate", "passthrough"])("synthesizes DONE at %s flush when stream is true", async (mode) => {
    expect(doneCount(await transformResponses(mode, { stream: true }))).toBe(1);
  });

  it.each([
    ["translate", false],
    ["translate", undefined],
    ["passthrough", false],
    ["passthrough", undefined],
  ])("does not synthesize DONE at %s flush when stream is %s", async (mode, stream) => {
    const body = stream === undefined ? {} : { stream };
    expect(doneCount(await transformResponses(mode, body))).toBe(0);
  });

  it.each([
    ["translate", false],
    ["translate", undefined],
    ["passthrough", false],
    ["passthrough", undefined],
  ])("forwards genuine upstream DONE once in %s mode when stream is %s", async (mode, stream) => {
    const body = stream === undefined ? {} : { stream };
    expect(doneCount(await transformResponses(mode, body, `${completed}data: [DONE]\n\n`))).toBe(1);
  });

  it.each([false, undefined])("does not synthesize OpenAI passthrough DONE when stream is %s", async (stream) => {
    const body = stream === undefined ? {} : { stream };
    expect(doneCount(await transformOpenAI(body))).toBe(0);
  });

  it("synthesizes OpenAI passthrough DONE when stream is true", async () => {
    expect(doneCount(await transformOpenAI({ stream: true }))).toBe(1);
  });

  it.each([false, undefined])("forwards genuine OpenAI passthrough DONE once when stream is %s", async (stream) => {
    const body = stream === undefined ? {} : { stream };
    expect(doneCount(await transformOpenAI(body, true))).toBe(1);
  });
});
