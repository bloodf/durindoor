import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxyAwareFetchMock } = vi.hoisted(() => ({ proxyAwareFetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

import "../translator/registerAll.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

/**
 * OmniRoute #412 (head d79b55be5ae282b11373e3d157d679c8fbf6d9ff, merge
 * d261ae7883df861d9a7759bb83dcc78dc16e21b0) declared the request parameters
 * the legacy OpenAI reasoning models reject with a 400 and deleted them from
 * the translated body before the executor call.
 *
 * DurinDoor keeps the upstream model set intersected with the live local
 * OpenAI catalog: `o1`, `o1-2024-12-17`, `o1-pro`, `o1-pro-2025-03-19` and
 * `o3`. `o1-mini` and `o3-mini` were retired from the local registry, and
 * `o3-pro` is not in the upstream list.
 *
 * Every case below runs offline against a mocked transport: no provider is
 * contacted, no credential is read, and no request leaves the machine.
 */

// The upstream `REASONING_UNSUPPORTED` list, verbatim.
const UNSUPPORTED = [
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "logprobs",
  "top_logprobs",
  "n",
];

const LEGACY_MODELS = ["o1", "o1-2024-12-17", "o1-pro", "o1-pro-2025-03-19", "o3"];

// Models that accept sampling controls, or that the upstream list does not
// name. `o3-pro` is a live local row outside the upstream contract; `o1-mini`
// and `o3-mini` were retired from the local registry.
const PRESERVED_MODELS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-5.6",
  "gpt-5.6-sol",
  "o3-pro",
  "o1-mini",
  "o3-mini",
  "o4-mini",
  "o1-preview",
];

const credentials = {
  apiKey: "offline-fixture-not-a-credential",
  // The o-series rows resolve to the Responses transport, so both dispatch
  // shapes post to /v1/responses for these models.
  runtimeTransport: { format: "openai-responses", baseUrl: "https://api.openai.com/v1/responses" },
};

const has = (body, key) => Object.hasOwn(body, key);

const chatBody = () => ({
  model: "o3",
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.7,
  top_p: 0.9,
  frequency_penalty: 0.1,
  presence_penalty: 0.2,
  logprobs: true,
  top_logprobs: 3,
  n: 2,
  max_tokens: 512,
  reasoning_effort: "medium",
  tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }],
  tool_choice: "auto",
});

const responsesBody = () => ({
  model: "o3",
  input: "hi",
  temperature: 0.7,
  top_p: 0.9,
  frequency_penalty: 0.1,
  presence_penalty: 0.2,
  logprobs: true,
  top_logprobs: 3,
  n: 2,
  max_output_tokens: 512,
  reasoning: { effort: "medium" },
  tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} }, strict: false }],
});

// Drive one outbound dispatch through the mocked transport and return the
// JSON body that reached the wire.
async function sendWireBody(executor, model, body) {
  proxyAwareFetchMock.mockReset();
  proxyAwareFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    id: "offline-fixture",
    model,
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  await executor.execute({
    model,
    body,
    stream: false,
    credentials,
    log: { debug: vi.fn(), warn: vi.fn() },
    requestPolicy: { maxTransportAttempts: 1 },
  });
  const [url, options] = proxyAwareFetchMock.mock.calls.at(-1);
  return { url, sent: JSON.parse(options.body) };
}

beforeEach(() => proxyAwareFetchMock.mockReset());

describe("OmniRoute #412: legacy OpenAI reasoning models drop the unsupported sampling fields", () => {
  it.each(LEGACY_MODELS)("native Responses dispatch strips every unsupported field for %s", async (model) => {
    const { url, sent } = await sendWireBody(new DefaultExecutor("openai"), model, responsesBody());

    expect(url).toBe("https://api.openai.com/v1/responses");
    for (const field of UNSUPPORTED) expect(has(sent, field), field).toBe(false);
    // Reasoning, tool and token-limit fields survive the strip.
    expect(sent.reasoning).toMatchObject({ effort: "medium" });
    expect(sent.tools).toHaveLength(1);
    expect(sent.max_output_tokens).toBe(512);
    expect(sent.input).toBe("hi");
  });

  it.each(LEGACY_MODELS)("Chat-to-Responses dispatch strips the sampling fields for %s", async (model) => {
    // The chat-to-Responses translation itself still copies temperature and
    // top_p; the strip happens on the outbound boundary, not in translation.
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      model,
      chatBody(),
      true,
      null,
      "openai",
    );
    expect(translated.temperature).toBe(0.7);
    expect(translated.top_p).toBe(0.9);

    const { url, sent } = await sendWireBody(new DefaultExecutor("openai"), model, translated);

    expect(url).toBe("https://api.openai.com/v1/responses");
    for (const field of UNSUPPORTED) expect(has(sent, field), field).toBe(false);
    expect(sent.reasoning).toMatchObject({ effort: "medium" });
    expect(sent.tools).toHaveLength(1);
    expect(sent.max_output_tokens).toBe(512);
  });

  it("removes only the listed fields and never invents one", () => {
    const body = { temperature: 0.7, max_completion_tokens: 512, reasoning: { effort: "high" }, tools: [] };
    stripUnsupportedParams("openai", "o3", body);
    expect(body).toEqual({ max_completion_tokens: 512, reasoning: { effort: "high" }, tools: [] });
  });

  it("resolves a provider-prefixed model id to the same rule", () => {
    const body = { temperature: 0.7, top_p: 0.9 };
    stripUnsupportedParams("openai", "openai/o3", body);
    expect(body).toEqual({});
  });
});

describe("OmniRoute #412: sampling fields are preserved everywhere else", () => {
  it.each(PRESERVED_MODELS)("keeps the sampling fields for the openai provider and %s", async (model) => {
    const { sent } = await sendWireBody(new DefaultExecutor("openai"), model, responsesBody());

    expect(sent.temperature).toBe(0.7);
    expect(sent.top_p).toBe(0.9);
    expect(sent.frequency_penalty).toBe(0.1);
    expect(sent.presence_penalty).toBe(0.2);
    expect(sent.logprobs).toBe(true);
    expect(sent.top_logprobs).toBe(3);
    expect(sent.n).toBe(2);
  });

  it.each([
    ["openrouter", "openai/o3"],
    ["openai-compatible-custom", "o3"],
    ["azure-openai", "o3"],
    ["github", "o3"],
  ])("keeps the sampling fields for the %s provider serving %s", async (provider, model) => {
    const { sent } = await sendWireBody(new DefaultExecutor(provider), model, responsesBody());

    expect(sent.temperature).toBe(0.7);
    expect(sent.top_p).toBe(0.9);
  });

  it("keeps the sampling fields on a proxy route that only names an o-series model", () => {
    const body = { temperature: 0.7, top_p: 0.9 };
    stripUnsupportedParams("openai-compatible-custom", "openai/o3", body);
    expect(body).toEqual({ temperature: 0.7, top_p: 0.9 });
  });
});
