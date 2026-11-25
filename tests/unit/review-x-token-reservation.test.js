/**
 * Issues #2531 and #2532: the lifetime token reservation caps every output
 * field and multiplies by `n`, and sizes unlimited and inline-media requests
 * without taking the whole quota.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/driver.js", () => ({
  getAdapterSync: () => ({ get: () => undefined }),
}));

const { reserveLifetimeTokens, estimateInputTokens, __resetLifetimeTokenReservationsForTests } =
  await import("@/lib/apiKeyTokenReservations.js");
await import("../translator/registerAll.js");
const { translateRequest } = await import("open-sse/translator/index.js");
const { FORMATS } = await import("open-sse/translator/formats.js");

const key = (maxTokens) => ({ id: "key-1", isActive: true, policy: { maxTokens } });
const messages = [{ role: "user", content: "hi" }];
const reserve = (limit, body, context) =>
  reserveLifetimeTokens(new Request("http://localhost/v1/chat/completions"), key(limit), body, Date.now(), context);
const wireLimits = (body) =>
  [body.max_tokens, body.max_completion_tokens, body.max_output_tokens, body.generationConfig?.maxOutputTokens]
    .filter((value) => value !== undefined);

beforeEach(() => __resetLifetimeTokenReservationsForTests());

describe("decoy output fields (#2531)", () => {
  const cases = [
    ["Claude", FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.6", { messages, max_completion_tokens: 1, max_tokens: 60000 }],
    ["OpenAI-compatible", FORMATS.OPENAI, FORMATS.OPENAI, "some-model", { messages, max_completion_tokens: 1, max_tokens: 60000 }],
    ["Responses", FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5", { messages, max_completion_tokens: 1, max_output_tokens: 60000 }],
    ["Responses source", FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "some-model", { input: "hi", max_output_tokens: 1, max_tokens: 60000 }],
    ["Claude with only a foreign field", FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.6", { messages, max_output_tokens: 1 }],
    ["Responses with only a foreign field", FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "some-model", { input: "hi", max_tokens: 5 }],
    ["null shadowing field", FORMATS.OPENAI, FORMATS.OPENAI, "gpt-5", { messages, max_completion_tokens: null, max_tokens: 60000 }],
  ];

  it.each(cases)("caps the wire limit: %s", (_name, source, target, model, body) => {
    const result = reserve(1000, { model, ...body }, { sourceFormat: source });
    const wire = translateRequest(source, target, model, result.body, false, null, target === FORMATS.CLAUDE ? "claude" : "openai");
    const limits = wireLimits(wire);
    expect(limits.length).toBeGreaterThan(0);
    for (const value of limits) {
      expect(value).toBeGreaterThan(0);
      // The reservation covers whatever limit reaches the provider.
      expect(value).toBeLessThanOrEqual(result.tokens - estimateInputTokens(body));
    }
    expect(result.tokens).toBeLessThanOrEqual(1000);
  });

  it("caps native Gemini limits, including the Antigravity wrapper", () => {
    const gemini = reserve(1000, { contents: [], generationConfig: { maxOutputTokens: 60000 } });
    expect(gemini.body.generationConfig.maxOutputTokens).toBeLessThan(1000);
    __resetLifetimeTokenReservationsForTests();
    const wrapped = reserve(1000, { request: { contents: [], generationConfig: { maxOutputTokens: 60000 } } });
    expect(wrapped.body.request.generationConfig.maxOutputTokens).toBeLessThan(1000);
  });

  it("multiplies the reservation by n", () => {
    const body = { model: "m", messages, max_tokens: 100 };
    const result = reserve(100000, { ...body, n: 5 });
    expect(result.tokens).toBe(estimateInputTokens(body) + 500);
    expect(result.body.max_tokens).toBe(100);
  });

  it("never reserves past the cap when n is large", () => {
    const result = reserve(1000, { model: "m", messages, n: 4, max_tokens: 60000 });
    expect(result.tokens).toBeLessThanOrEqual(1000);
    expect(result.body.max_tokens * 4).toBeLessThan(1000);
  });

  it("counts tools and instructions as input", () => {
    const text = "x".repeat(4000);
    expect(estimateInputTokens({ messages, tools: [{ function: { description: text } }] })).toBeGreaterThan(1000);
    expect(estimateInputTokens({ input: "hi", instructions: text })).toBeGreaterThan(1000);
  });
});

describe("reservation sizing (#2532)", () => {
  it("does not reserve the whole quota when no limit is sent", () => {
    const body = { model: "unknown-model", messages };
    const first = reserve(1_000_000, body);
    expect(first.body.max_tokens).toBe(8192);
    expect(first.tokens).toBe(estimateInputTokens(body) + 8192);
    expect(reserve(1_000_000, body).ok).toBe(true);
  });

  it("uses the model's published max output when it is known", () => {
    const result = reserve(1_000_000, { model: "m", messages }, { modelMaxOutput: 128000 });
    expect(result.body.max_tokens).toBe(128000);
  });

  const data = "A".repeat(1024 * 1024);
  const url = `data:image/png;base64,${data}`;
  it.each([
    ["image_url", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] }],
    ["input_image", { input: [{ role: "user", content: [{ type: "input_image", image_url: url }] }] }],
    ["input_audio", { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data, format: "wav" } }] }] }],
    ["file_data", { messages: [{ role: "user", content: [{ type: "file", file: { file_data: data } }] }] }],
    ["Claude source", { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }] }] }],
    ["Gemini inlineData", { contents: [{ parts: [{ inlineData: { mimeType: "image/png", data } }] }] }],
  ])("admits a 1 MB %s part under a 200k cap", (_name, body) => {
    const result = reserve(200_000, { model: "m", max_tokens: 100, ...body });
    expect(result.ok).toBe(true);
    expect(result.tokens).toBeLessThan(1500);
  });

  it("still measures prose that only looks like a data URL", () => {
    const content = `data:text/plain;base64, ${"plain words. ".repeat(1000)}`;
    expect(estimateInputTokens({ messages: [{ role: "user", content: [{ type: "text", url: content }] }] })).toBeGreaterThan(3000);
  });
});
