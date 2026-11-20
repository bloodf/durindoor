import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...await original(), proxyAwareFetch: wire }));
vi.mock("open-sse/services/liveModelLimits.js", async (original) => ({ ...await original(), warmLiveModelLimits: vi.fn() }));

const model = "gemini-4-hydrogen";
const provider = "gemini-interactions";
const modelsUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const interactionsUrl = "https://generativelanguage.googleapis.com/v1beta/interactions";
const usage = { total_input_tokens: 11, total_output_tokens: 8, total_thought_tokens: 3, total_cached_tokens: 2, total_tokens: 22 };
const complete = { id: "synthetic-upstream", status: "completed", model, usage };
const text = "Text from the fixture.";
const reply = { ...complete, steps: [{ type: "model_output", content: [{ type: "text", text }] }] };
const event = (event_type, data) => `event: ${event_type}\r\ndata: ${JSON.stringify({ event_type, ...data })}\r\n\r\n`;
const sse = (frames) => {
  const bytes = new TextEncoder().encode(frames.join(""));
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 19) controller.enqueue(bytes.slice(i, i + 19));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
};

let db, adapter, post, chat, discover, gatewayModels, buildProbe, directory, owned, other, caller;
const request = (url, payload, headers = {}) => new Request(`https://gateway.test${url}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(payload),
});
const send = (body = {}, headers = { "x-goog-api-key": caller.key }) =>
  post(request("/v1beta/interactions", { model, input: "Hello", ...body }, headers));

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-interactions-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected direct fetch in closed fixture"); }));
  db = await import("@/lib/localDb");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  await db.updateSettings({ requireApiKey: true });
  const connect = (name, selectedProvider) => db.createProviderConnection({
    name, provider: selectedProvider, authType: "apikey", apiKey: `fixture-${name}`, isActive: true,
  });
  other = await connect("unowned", provider);
  owned = await connect("owned", provider);
  await connect("legacy", "gemini");
  caller = await db.createApiKey("Fixture client", "synthetic-machine", [], null, null, { providerConnectionIds: [owned.id] });
  ({ POST: post } = await import("@/app/api/v1beta/interactions/route.js"));
  ({ POST: chat } = await import("@/app/api/v1/chat/completions/route.js"));
  ({ GET: discover } = await import("@/app/api/providers/[id]/models/route.js"));
  ({ buildRegistryProviderProbe: buildProbe } = await import("@/app/api/providers/providerProbe.js"));
  ({ GET: gatewayModels } = await import("@/app/api/v1beta/models/route.js"));
}, 30_000);

afterAll(async () => {
  await adapter?.close?.();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  wire.mockReset();
  wire.mockImplementation(async (url, init) => {
    if (url === `${modelsUrl}?pageSize=1000`) {
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("fixture-owned");
      return Response.json({ models: [{ name: `models/${model}` }, { name: "models/gemini-embedding-001" }] });
    }
    expect(url).toBe(interactionsUrl);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("fixture-owned");
    expect(new Headers(init.headers).get("api-revision")).toBe("2026-05-20");
    const payload = JSON.parse(init.body);
    expect(payload).toEqual({ model, input: "Hello", stream: payload.stream, store: false });
    if (!payload.stream) return Response.json(reply);
    return sse([
      event("interaction.created", { interaction: { id: "synthetic-upstream", status: "in_progress" } }),
      event("step.start", { index: 0, step: { type: "thought" } }),
      event("step.delta", { index: 0, delta: { type: "thought_summary", content: { type: "text", text: "private thought" } } }),
      event("step.stop", { index: 0 }),
      event("step.start", { index: 1, step: { type: "model_output" } }),
      event("step.delta", { index: 1, delta: { type: "text", text } }),
      event("step.stop", { index: 1 }),
      event("interaction.completed", { interaction: complete }),
    ]);
  });
});

describe("stateless Gemini Interactions provider", () => {
  it("discovers account-visible supported text models and exposes a separate gateway model", async () => {
    const result = await discover(new Request("https://gateway.test/api/providers/id/models"), { params: Promise.resolve({ id: owned.id }) });
    expect(result.status).toBe(200);
    expect((await result.json()).models.map(({ id }) => id)).toEqual([model]);
    const listed = (await (await gatewayModels()).json()).models.map(({ name }) => name);
    expect(listed).toContain(`models/${provider}/${model}`);
    expect(listed).toContain("models/gemini/gemini-2.5-flash");
  });

  it("configures connection validation as a key-authenticated model lookup", () => {
    const probe = buildProbe(provider, owned.apiKey, { baseUrl: "https://untrusted.test" });
    expect(probe.url).toBe(modelsUrl);
    expect(new Headers(probe.options.headers).get("x-goog-api-key")).toBe("fixture-owned");
    expect(probe.fallback).toBeUndefined();
  });

  it("rejects missing and invalid client keys and an unowned account pin before dispatch", async () => {
    expect((await send({}, {})).status).toBe(401);
    expect((await send({}, { "x-goog-api-key": "fixture-invalid" })).status).toBe(401);
    const denied = await send({}, { "x-goog-api-key": caller.key, "x-connection-id": other.id });
    expect(denied.status).toBe(400);
    expect(await denied.text()).toContain("not available for this API key");
    expect(wire).not.toHaveBeenCalled();
  });

  it("rejects a valid payload labeled text/plain before dispatch", async () => {
    const response = await send({}, {
      "x-goog-api-key": caller.key,
      "content-type": "text/plain",
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      error: { code: 415, message: "Content-Type must be application/json" },
    });
    expect(wire).not.toHaveBeenCalled();
  });

  it("accepts application/json with parameters", async () => {
    const response = await send({}, {
      "x-goog-api-key": caller.key,
      "content-type": "application/json; charset=utf-8",
    });
    expect(response.status).toBe(200);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("returns the native parsing error for malformed JSON", async () => {
    const response = await post(new Request("https://gateway.test/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": caller.key, "content-type": "application/json" },
      body: "{",
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ error: { code: 400, message: "Invalid JSON" } });
    expect(wire).not.toHaveBeenCalled();
  });

  it("rejects retained state, background execution and identifiers", async () => {
    for (const body of [{ store: true }, { background: true }, { previous_interaction_id: "foreign" }, { input: [{ type: "image" }] }]) {
      expect((await send(body)).status).toBe(400);
    }
    expect(wire).not.toHaveBeenCalled();
  });

  it("creates a stateless interaction on the scoped account and records provider tokens", async () => {
    const before = await db.getApiKeyUsageTotals(caller.id);
    const response = await send({ store: false });
    expect(response.status, response.status === 200 ? "" : await response.clone().text()).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ model, status: "completed", steps: reply.steps, usage });
    expect(result.id).toMatch(/^local_/);
    expect(wire).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      expect((await db.getApiKeyUsageTotals(caller.id)).totalTokens).toBe(before.totalTokens + 22);
    });
  });

  it("streams text and terminal usage through the public route", async () => {
    const before = await db.getApiKeyUsageTotals(caller.id);
    const response = await send({ stream: true });
    expect(response.status).toBe(200);
    const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));
    expect(events.map(({ event_type }) => event_type)).toEqual([
      "interaction.created", "step.start", "step.delta", "step.stop", "interaction.completed",
    ]);
    expect(events[2].delta).toEqual({ type: "text", text });
    expect(events.at(-1).interaction.usage).toEqual(usage);
    await vi.waitFor(async () => {
      expect((await db.getApiKeyUsageTotals(caller.id)).totalTokens).toBe(before.totalTokens + 22);
    });
  });

  it("supports the existing chat completion entry point", async () => {
    const response = await chat(request("/v1/chat/completions", {
      model: `${provider}/${model}`, messages: [{ role: "user", content: "Hello" }], stream: false,
    }, { authorization: `Bearer ${caller.key}`, accept: "application/json" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 11, completion_tokens: 11, total_tokens: 22 },
    });
  });

  it("maps provider HTTP and stream errors without retrying without store=false", async () => {
    wire.mockResolvedValueOnce(Response.json({ error: { message: "Unknown name \"store\"" } }, { status: 400 }));
    const rejected = await send();
    expect(rejected.status).toBe(400);
    expect(wire).toHaveBeenCalledTimes(1);

    wire.mockResolvedValueOnce(sse([event("error", { error: { code: "gateway_timeout", message: "Deadline expired" } })]));
    const failed = await send({ stream: true });
    expect(failed.status).toBe(200);
    const output = await failed.text();
    expect(output).toContain("event: error");
    expect(output).not.toContain("event: interaction.completed");
  });
});
