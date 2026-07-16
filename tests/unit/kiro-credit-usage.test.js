// Port of decolua/9router PR #2618: Kiro meters usage in credits, not tokens.
// The Kiro executor attaches `kiro_credits`/`kiro_credit_unit` to usage via
// meteringEvent; these fields must survive usage normalization,
// canonicalization (persistence), and estimate merging. Injected/
// format-filtered client usage omits them via filterUsageForFormat; raw
// passthrough usage chunks are forwarded verbatim (pre-existing behavior).
import { describe, it, expect, vi } from "vitest";
import "../translator/registerAll.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import {
  canonicalizeUsage,
  extractUsage,
  filterUsageForFormat,
  hasValidUsage,
  mergeUsage,
  normalizeUsage,
} from "../../open-sse/utils/usageTracking.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createMockFrame(eventType, payloadObj) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const headerNameBytes = new TextEncoder().encode(":event-type");
  const headerValueBytes = new TextEncoder().encode(eventType);
  const headerLength = 1 + headerNameBytes.length + 1 + 2 + headerValueBytes.length;
  const totalLength = 12 + headerLength + payloadBytes.length + 4;
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);
  view.setUint32(8, crc32(buffer.subarray(0, 8)), false);
  let offset = 12;
  buffer[offset++] = headerNameBytes.length;
  buffer.set(headerNameBytes, offset);
  offset += headerNameBytes.length;
  buffer[offset++] = 7; // String type
  view.setUint16(offset, headerValueBytes.length, false);
  offset += 2;
  buffer.set(headerValueBytes, offset);
  offset += headerValueBytes.length;
  buffer.set(payloadBytes, offset);
  view.setUint32(totalLength - 4, crc32(buffer.subarray(0, totalLength - 4)), false);
  return buffer;
}

async function readAllSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}

function parseSSEObjects(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)));
}

function framesStream(frames) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
}

describe("Kiro credit usage — executor", () => {
  it("credit-only: emits estimated tokens with kiro_credits preserved on the final chunk", async () => {
    const executor = new KiroExecutor();
    const frames = [
      createMockFrame("assistantResponseEvent", { content: "OK" }),
      createMockFrame("messageStopEvent", {}),
      createMockFrame("meteringEvent", { usage: 0.0097, unit: "credit", unitPlural: "credits" }),
      createMockFrame("contextUsageEvent", { contextUsagePercentage: 12 }),
    ];
    const output = await readAllSSE(executor.transformEventStreamToSSE({ body: framesStream(frames) }, "claude-test").body);
    const objects = parseSSEObjects(output);

    const usageChunk = objects.find((obj) => obj.usage?.kiro_credits !== undefined);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage.kiro_credits).toBe(0.0097);
    expect(usageChunk.usage.kiro_credit_unit).toBe("credit");
    // Token counts are estimated, not absent — normal token accounting still works
    expect(usageChunk.usage.prompt_tokens).toBeGreaterThan(0);
    expect(usageChunk.usage.completion_tokens).toBeGreaterThan(0);
  });

  it("mixed: metricsEvent tokens and meteringEvent credits land on the same usage object", async () => {
    const executor = new KiroExecutor();
    const frames = [
      createMockFrame("assistantResponseEvent", { content: "OK" }),
      createMockFrame("messageStopEvent", {}),
      createMockFrame("metricsEvent", { inputTokens: 42, outputTokens: 7 }),
      createMockFrame("meteringEvent", { usage: 0.0061, unit: "credit" }),
      createMockFrame("contextUsageEvent", { contextUsagePercentage: 12 }),
    ];
    const output = await readAllSSE(executor.transformEventStreamToSSE({ body: framesStream(frames) }, "claude-test").body);
    const objects = parseSSEObjects(output);

    const usageChunk = objects.find((obj) => obj.usage?.kiro_credits !== undefined);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage).toMatchObject({
      prompt_tokens: 42,
      completion_tokens: 7,
      total_tokens: 49,
      kiro_credits: 0.0061,
      kiro_credit_unit: "credit",
    });
  });

  it("mixed reverse order: meteringEvent credits survive a later metricsEvent", async () => {
    const executor = new KiroExecutor();
    const frames = [
      createMockFrame("assistantResponseEvent", { content: "OK" }),
      createMockFrame("messageStopEvent", {}),
      createMockFrame("meteringEvent", { usage: 0.0061, unit: "credit" }),
      createMockFrame("metricsEvent", { inputTokens: 42, outputTokens: 7 }),
      createMockFrame("contextUsageEvent", { contextUsagePercentage: 12 }),
    ];
    const output = await readAllSSE(executor.transformEventStreamToSSE({ body: framesStream(frames) }, "claude-test").body);
    const objects = parseSSEObjects(output);

    const usageChunk = objects.find((obj) => obj.usage?.kiro_credits !== undefined);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage).toMatchObject({
      prompt_tokens: 42,
      completion_tokens: 7,
      total_tokens: 49,
      kiro_credits: 0.0061,
      kiro_credit_unit: "credit",
    });
  });

  it("malformed: null/negative metering usage is ignored and estimation still proceeds", async () => {
    for (const badUsage of [null, -0.5]) {
      const executor = new KiroExecutor();
      const frames = [
        createMockFrame("assistantResponseEvent", { content: "OK" }),
        createMockFrame("messageStopEvent", {}),
        createMockFrame("meteringEvent", { usage: badUsage }),
        createMockFrame("contextUsageEvent", { contextUsagePercentage: 12 }),
      ];
      const output = await readAllSSE(executor.transformEventStreamToSSE({ body: framesStream(frames) }, "claude-test").body);
      const objects = parseSSEObjects(output);

      const usageChunk = objects.find((obj) => obj.usage);
      expect(usageChunk.usage.kiro_credits).toBeUndefined();
      expect(usageChunk.usage.kiro_credit_unit).toBeUndefined();
      // Malformed credits don't block the terminal path: estimated tokens still present
      expect(usageChunk.usage.prompt_tokens).toBeGreaterThan(0);
    }
  });

  it("control: token-only streams carry no kiro fields", async () => {
    const executor = new KiroExecutor();
    const frames = [
      createMockFrame("assistantResponseEvent", { content: "OK" }),
      createMockFrame("messageStopEvent", {}),
      createMockFrame("metricsEvent", { inputTokens: 10, outputTokens: 5 }),
      createMockFrame("contextUsageEvent", { contextUsagePercentage: 12 }),
    ];
    const output = await readAllSSE(executor.transformEventStreamToSSE({ body: framesStream(frames) }, "claude-test").body);
    const objects = parseSSEObjects(output);

    const usageChunk = objects.find((obj) => obj.usage);
    expect(usageChunk.usage.prompt_tokens).toBe(10);
    expect(usageChunk.usage.kiro_credits).toBeUndefined();
    expect(usageChunk.usage.kiro_credit_unit).toBeUndefined();
  });
});

describe("Kiro credit usage — normalization", () => {
  it("extracts credit-only usage for internal persistence", () => {
    const usage = extractUsage({
      usage: { kiro_credits: 0.003, kiro_credit_unit: "credit" },
    });
    expect(usage.kiro_credits).toBe(0.003);
    expect(usage.kiro_credit_unit).toBe("credit");
    // Credit-only usage carries no token counts and stays estimation-eligible
    expect(usage.prompt_tokens).toBeUndefined();
    expect(hasValidUsage(usage)).toBe(false);
  });

  it("keeps prompt-only OpenAI usage complete while credit-only Kiro usage stays tokenless", () => {
    const promptOnly = extractUsage({ usage: { prompt_tokens: 123 } });
    expect(promptOnly.prompt_tokens).toBe(123);
    expect(promptOnly.completion_tokens).toBe(0);

    const creditOnly = extractUsage({ usage: { kiro_credits: 0.001, kiro_credit_unit: "credit" } });
    expect(creditOnly.kiro_credits).toBe(0.001);
    expect(creditOnly.completion_tokens).toBeUndefined();
  });

  it("preserves credits through canonicalizeUsage alongside token counts", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      kiro_credits: 0.0123,
      kiro_credit_unit: "credit",
    });
    expect(out.kiro_credits).toBe(0.0123);
    expect(out.kiro_credit_unit).toBe("credit");
    expect(out.prompt_tokens).toBe(100);
  });

  it("drops malformed null/negative credits but keeps the unit only with valid credits", () => {
    expect(normalizeUsage({ kiro_credits: null })).toBeNull();
    expect(normalizeUsage({ kiro_credits: -1, kiro_credit_unit: "credit" })).toBeNull();
    expect(canonicalizeUsage({ prompt_tokens: 5, kiro_credits: null }).kiro_credits).toBeUndefined();
    expect(canonicalizeUsage({ prompt_tokens: 5, kiro_credits: -2 }).kiro_credits).toBeUndefined();
  });

  it("mergeUsage carries kiro_credit_unit when credits arrive after token usage", () => {
    const merged = mergeUsage(
      { prompt_tokens: 10, completion_tokens: 4 },
      { kiro_credits: 0.005, kiro_credit_unit: "credit" },
    );
    expect(merged).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 4,
      kiro_credits: 0.005,
      kiro_credit_unit: "credit",
    });
  });

  it("mergeUsage keeps credits when estimates merge over credit-only usage", () => {
    const merged = mergeUsage(
      { kiro_credits: 0.005, kiro_credit_unit: "credit" },
      { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, estimated: true },
    );
    expect(merged.kiro_credits).toBe(0.005);
    expect(merged.kiro_credit_unit).toBe("credit");
    expect(merged.prompt_tokens).toBe(100);
  });
});

describe("Kiro credit usage — format filtering", () => {
  it("filterUsageForFormat strips kiro fields from format-filtered usage", () => {
    const filtered = filterUsageForFormat(
      { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, kiro_credits: 0.005, kiro_credit_unit: "credit" },
      FORMATS.OPENAI,
    );
    expect(filtered.prompt_tokens).toBe(10);
    expect(filtered.kiro_credits).toBeUndefined();
    expect(filtered.kiro_credit_unit).toBeUndefined();
  });
});

describe("Kiro credit usage — outer stream pipeline", () => {
  it("credit-only usage chunk reaches onStreamComplete with estimated tokens merged", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "kiro", null, null, "claude-test", "connection-1",
      { messages: [{ role: "user", content: "hello" }] }, onComplete, "sk-test",
    );

    const encoder = new TextEncoder();
    const source = new ReadableStream({
      start(controller) {
        for (const chunk of [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [], usage: { kiro_credits: 0.0123, kiro_credit_unit: "credit" } })}\n\n`,
          "data: [DONE]\n\n",
        ]) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    await new Response(source.pipeThrough(transform)).text();

    expect(onComplete).toHaveBeenCalledTimes(1);
    const usage = onComplete.mock.calls[0][1];
    // Credits survive the estimate-merge in the outer stream
    expect(usage.kiro_credits).toBe(0.0123);
    expect(usage.kiro_credit_unit).toBe("credit");
    // Estimated token counts merged in, not overwritten
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    // NOTE: passthrough mode forwards the provider's trailing usage-only chunk
    // verbatim (by design, same as every provider usage chunk). Client privacy
    // for injected/filtered usage is covered by the filterUsageForFormat test.
  });
});
