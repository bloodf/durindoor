/**
 * Issue #1224 scope: offline acceptance of the installed native OrcaRouter
 * validator, catalog and executor, not acceptance of a same-named candidate.
 * Registry exports and synthetic responses prove wiring only. Account-backed
 * endpoint/auth/model/tool/stream proof remains unavailable; g4f, web sessions
 * and app-server transports are not native vendor support.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport.fetch }));
// Prevent the unrelated import-time updater from loading native fetch or timers.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn().mockResolvedValue("kimchi/offline-fixture"),
}));

import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { discoverOrcaRouterModels } from "../../open-sse/providers/orcarouterCatalog.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const KEY = "sk-orca-offline-fixture-not-a-credential";
const MODEL = "orcarouter/auto";
const API = "https://api.orcarouter.ai/v1";
const credentials = { apiKey: KEY };
const tool = {
  type: "function",
  function: {
    name: "weather",
    description: "Read weather",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};
const call = { id: "call_weather", type: "function", function: { name: "weather", arguments: '{"city":"Porto"}' } };
const request = (stream) => ({
  model: MODEL,
  stream,
  messages: [
    { role: "user", content: "Weather in Porto?" },
    { role: "assistant", content: null, tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, content: '{"temperature":20}' },
  ],
  tools: [tool],
  tool_choice: "auto",
});
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  transport.fetch.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected real fetch in offline acceptance"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("#1224 installed-native OrcaRouter offline acceptance", () => {
  it("validates, discovers a namespaced model, then executes a tool round trip on the native API", async () => {
    const validate = vi.fn().mockResolvedValue(json({ data: [] }));
    expect(await probeRegistryProvider("orcarouter", KEY, validate)).toEqual({ valid: true, status: 200 });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0][0]).toBe(`${API}/models`);
    expect(validate.mock.calls[0][1]).toMatchObject({ headers: { Authorization: `Bearer ${KEY}` }, redirect: "manual" });

    const catalog = vi.fn().mockResolvedValue(json({ data: [
      { id: MODEL, supported_endpoint_types: ["openai"], architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    ] }));
    const discovered = await discoverOrcaRouterModels({ apiKey: KEY, fetchImpl: catalog });
    expect(discovered).toMatchObject({ ok: true, source: "live", degraded: false });
    expect(discovered.models.map((model) => model.id)).toEqual([MODEL]);
    expect(catalog.mock.calls[0][0]).toBe(`${API}/models?capability=chat`);
    expect(catalog.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEY}`);

    const reply = { id: "offline-chat", object: "chat.completion", model: MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [call] }, finish_reason: "tool_calls" }] };
    transport.fetch.mockResolvedValueOnce(json(reply));
    const result = await getExecutor("orcarouter").execute({ model: discovered.models[0].id, body: request(false), stream: false, credentials });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = transport.fetch.mock.calls[0];
    expect(url).toBe(`${API}/chat/completions`);
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toMatchObject(request(false));
    expect(await result.response.json()).toEqual(reply);
  });

  it("preserves fragmented tool SSE and usage through the real executor without buffering it as JSON", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_weather","type":"function","function":{"name":"weather","arguments":"{\\\"city\\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"Porto\\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ];
    transport.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    const result = await getExecutor("orcarouter").execute({ model: MODEL, body: request(true), stream: true, credentials });
    const [url, init] = transport.fetch.mock.calls[0];
    expect(url).toBe(`${API}/chat/completions`);
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toMatchObject({ ...request(true), stream_options: { include_usage: true } });
    const received = await result.response.text();
    expect(received).toBe(frames.join(""));
    const chunks = received.split("\n\n").filter(Boolean).slice(0, -1).map((frame) => JSON.parse(frame.slice(6)));
    const argumentsText = chunks.slice(0, 2).map((chunk) => chunk.choices[0].delta.tool_calls[0].function.arguments).join("");
    expect(JSON.parse(argumentsText)).toEqual({ city: "Porto" });
    expect(chunks[2].usage.total_tokens).toBe(15);
  });

  it.each([401, 403, 422])("preserves native HTTP %s error bodies rather than turning them into successful chat", async (status) => {
    const error = { error: { type: "invalid_request_error", message: "Offline rejection", code: `fixture_${status}` } };
    transport.fetch.mockResolvedValueOnce(json(error, status));
    const result = await getExecutor("orcarouter").execute({ model: MODEL, body: request(false), stream: false, credentials });
    expect(result.response.status).toBe(status);
    expect(result.response.ok).toBe(false);
    expect(await result.response.json()).toEqual(error);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not validate an unregistered web candidate merely because native OrcaRouter is installed", async () => {
    const fetcher = vi.fn(() => { throw new Error("Unsupported candidate must not probe native account"); });
    expect(await probeRegistryProvider("orcarouter-web", KEY, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(transport.fetch).not.toHaveBeenCalled();
  });

  it("rejects an unknown candidate buildUrl with status 400 before credential dispatch", () => {
    const outcome = (() => {
      try {
        return { url: getExecutor("orcarouter-web").buildUrl(MODEL, false, 0, credentials) };
      } catch (error) {
        return { error };
      }
    })();
    expect(outcome).toMatchObject({ error: { status: 400 } });
    expect(outcome).not.toHaveProperty("url");
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects unknown candidate execution with status 400 and zero fetch or credential dispatch", async () => {
    // A wrong dispatch stays offline but remains observable and must fail this test.
    transport.fetch.mockResolvedValue(json({ error: { message: "Unsafe candidate dispatch" } }, 400));
    const outcome = await getExecutor("orcarouter-web").execute({
      model: MODEL, body: request(false), stream: false, credentials,
    }).then((result) => ({ result }), (error) => ({ error }));
    expect.soft(transport.fetch).not.toHaveBeenCalled();
    expect.soft(globalThis.fetch).not.toHaveBeenCalled();
    expect.soft(outcome).toMatchObject({ error: { status: 400 } });
    expect(outcome).not.toHaveProperty("result");
  });

  it("hides non-native candidate transports and undeclared vision from a successful native catalog", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ data: [
      { id: "candidate/g4f", supported_endpoint_types: ["g4f"] },
      { id: "candidate/web", supported_endpoint_types: ["web"] },
      { id: "candidate/app-server", supported_endpoint_types: ["app-server"] },
      { id: MODEL, supported_endpoint_types: ["openai"], architecture: { input_modalities: ["text"] } },
    ] }));
    const chat = await discoverOrcaRouterModels({ apiKey: KEY, fetchImpl });
    expect(chat.source).toBe("live");
    expect(chat.models.map((model) => model.id)).toEqual([MODEL]);
    fetchImpl.mockResolvedValueOnce(json({ data: [{ id: MODEL, supported_endpoint_types: ["openai"] }] }));
    const vision = await discoverOrcaRouterModels({ apiKey: KEY, modality: "image", fetchImpl });
    expect(vision).toMatchObject({ ok: true, source: "live", models: [] });
  });
});
