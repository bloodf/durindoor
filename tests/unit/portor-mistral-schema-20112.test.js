import { describe, expect, it } from "vitest";
import { findRejected422Field } from "../../open-sse/config/providerFieldStrips.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("Mistral chat schema", () => {
  it("normalizes unsupported OpenAI fields and preserves explicit targets", () => {
    const body = { messages: [], seed: 8, random_seed: 4, max_completion_tokens: 20, user: "u", logit_bias: {}, store: true, verbosity: "high", temperature: 2, service_tier: "flex", stream_options: { include_usage: true } };
    stripUnsupportedParams("mistral", "mistral-large-latest", body);
    expect(body).toEqual({ messages: [], random_seed: 4, max_tokens: 20, temperature: 1.5, service_tier: "standard_only", stream_options: { include_usage: true } });
  });
  it("leaves Responses bodies intact and drops unknown chat tiers", () => {
    const responses = { input: "hello", seed: 1, service_tier: "flex" };
    stripUnsupportedParams("mistral", "mistral-large-latest", responses);
    expect(responses).toEqual({ input: "hello", seed: 1, service_tier: "flex" });
    const chat = { messages: [], seed: null, service_tier: "constructor" };
    stripUnsupportedParams("mistral", "mistral-large-latest", chat);
    expect(chat).toEqual({ messages: [] });
  });
});

it("accepts only structured unprotected 422 fields", () => {
  const body = { messages: [], store: true, service_tier: "flex" };
  expect(findRejected422Field(JSON.stringify({ message: { detail: [{ type: "extra_forbidden", loc: ["body", "store"] }] } }), body)).toBe("store");
  expect(findRejected422Field(JSON.stringify({ detail: [{ type: "extra_forbidden", loc: ["body", "messages"] }] }), body)).toBeNull();
  expect(findRejected422Field(JSON.stringify({ detail: [{ type: "enum", loc: ["body", "service_tier"] }] }), body)).toBe("service_tier");
  expect(findRejected422Field(JSON.stringify({ message: "store is unsupported" }), body)).toBeNull();
});

it("retries successive structured 422 errors", async () => {
  const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
  const requests = [];
  const result = await new DefaultExecutor("mistral").execute({
    model: "mistral-large-latest", body: { messages: [], extra_a: 1, extra_b: 2 }, stream: false,
    credentials: { apiKey: "test" }, requestPolicy: { maxTransportAttempts: 3 },
    directFetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const field = requests.length === 1 ? "extra_a" : requests.length === 2 ? "extra_b" : null;
      return field ? Response.json({ detail: [{ type: "extra_forbidden", loc: ["body", field] }] }, { status: 422 }) : Response.json({ ok: true });
    },
  });
  expect(result.response.status).toBe(200);
  expect(requests.map(({ extra_a, extra_b }) => [extra_a, extra_b])).toEqual([[1, 2], [undefined, 2], [undefined, undefined]]);
});
