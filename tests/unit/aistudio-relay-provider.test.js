import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { addBufferToUsage } from "open-sse/utils/usageTracking.js";

const sidecarFetch = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: sidecarFetch,
}));

const sidecar = "http://127.0.0.1:8317";
const appRoute = "office-build-fixture";
const devinRoute = "devin/swe-fixture";
const relayKey = "fixture-relay";
const usage = { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 };

let dataDir;
let postChat;
let listModels;
let listGatewayModels;
let disposeDetails;
let clients;
let connections;
const sessions = new Map();
let channelCount = 0;

function connectApp(url) {
  const upgrade = new URL(url);
  if (upgrade.origin !== "ws://127.0.0.1:8317" || upgrade.pathname !== "/v1/ws" ||
      upgrade.searchParams.get("auth_token") !== relayKey) return null;
  // The sidecar assigns the ephemeral identity. A caller-supplied name cannot select it.
  const channel = `aistudio-fixture-${++channelCount}`;
  sessions.set(channel, { provider: "aistudio", model: appRoute });
  return { channel, disconnect: () => sessions.delete(channel) };
}

function error(status, message) {
  return Response.json({ error: { message } }, { status });
}

async function proxyRequest(url, init) {
  const path = String(url).replace(sidecar, "");
  expect(String(url)).toBe(sidecar + path);
  const key = new Headers(init.headers).get("authorization");
  if (key === "Bearer fixture-invalid") return error(401, "Invalid proxy key");
  expect(["Bearer fixture-build", "Bearer fixture-devin"]).toContain(key);
  const app = [...sessions.values()].find((session) => session.provider === "aistudio");
  if (path === "/v1/models") {
    expect(init.method).toBe("GET");
    return Response.json({ data: [app?.model, devinRoute].filter(Boolean).map((id) => ({ id, object: "model" })) });
  }
  expect(path).toBe("/v1/chat/completions");
  expect(init.method).toBe("POST");
  const body = JSON.parse(init.body);
  expect(body.messages[0].content).toBe("hello");
  const content = body.model === app?.model ? "build reply" : body.model === devinRoute ? "devin reply" : null;
  if (!content) return error(503, "No connected relay for model");
  const common = { id: "fixture-reply", created: 1, model: body.model };
  if (!body.stream) {
    return Response.json({
      ...common, object: "chat.completion", usage,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    });
  }
  const chunks = [
    { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage },
  ].map((chunk) => `data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", ...chunk })}\n\n`);
  return new Response(chunks.join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "durindoor-aistudio-fixture-"));
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubGlobal("fetch", (url, init) => sidecarFetch(url, init));

  const { createProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
  const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
  ({ disposeRequestDetailsRepo: disposeDetails } = await import("@/lib/db/repos/requestDetailsRepo.js"));
  ({ POST: postChat } = await import("@/app/api/v1/chat/completions/route.js"));
  ({ GET: listGatewayModels } = await import("@/app/api/v1/models/route.js"));
  ({ GET: listModels } = await import("@/app/api/providers/[id]/models/route.js"));

  await updateSettings({ requireApiKey: true, visionBridgeEnabled: false });
  connections = {};
  clients = {};
  for (const name of ["build", "devin", "invalid", "gemini"]) {
    connections[name] = await createProviderConnection({
      provider: name === "gemini" ? "gemini-cli" : "cliproxyapi",
      authType: "apikey", name, apiKey: `fixture-${name}`, isActive: true,
    });
    clients[name] = (await createApiKey(name, "fixture-machine", [], null, null, {
      providerConnectionIds: [connections[name].id],
    })).key;
  }
}, 30000);

beforeEach(() => {
  sessions.clear();
  channelCount = 0;
  sidecarFetch.mockReset();
  sidecarFetch.mockImplementation(proxyRequest);
});

afterAll(async () => {
  try {
    await disposeDetails?.();
    await globalThis._dbAdapter?.instance?.close?.();
    delete globalThis._dbAdapter;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

function chat(model, key, stream = false) {
  return postChat(new Request("http://durindoor.invalid/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
    // A streaming client asks for the usage trailer; an unrequested one is dropped.
    body: JSON.stringify({ model, stream, ...(stream && { stream_options: { include_usage: true } }), messages: [{ role: "user", content: "hello" }] }),
  }));
}

function models(connection) {
  return listModels(new Request(`http://durindoor.invalid/api/providers/${connection.id}/models`), {
    params: Promise.resolve({ id: connection.id }),
  });
}

describe("AI Studio Build through the existing CLIProxyAPI connection", () => {
  it("discovers the provider alias only while the authenticated app is connected", async () => {
    expect(connectApp("ws://127.0.0.1:8317/v1/ws")).toBeNull();
    expect(connectApp("ws://127.0.0.1:8317/v1/ws?auth_token=wrong")).toBeNull();
    const app = connectApp(`ws://127.0.0.1:8317/v1/ws?auth_token=${relayKey}&provider_name=caller-chosen`);
    expect(app.channel).toBe("aistudio-fixture-1");
    expect((await (await models(connections.build)).json()).models.map(({ id }) => id)).toEqual([appRoute, devinRoute]);
    app.disconnect();
    expect((await (await models(connections.build)).json()).models.map(({ id }) => id)).toEqual([devinRoute]);
    const reconnected = connectApp(`ws://127.0.0.1:8317/v1/ws?auth_token=${relayKey}`);
    expect(reconnected.channel).toBe("aistudio-fixture-2");
    app.disconnect();
    expect((await (await models(connections.build)).json()).models.map(({ id }) => id)).toContain(appRoute);
    expect((await models(connections.invalid)).status).toBe(401);
  });

  it("publishes routable model IDs through the local gateway catalog", async () => {
    connectApp(`ws://127.0.0.1:8317/v1/ws?auth_token=${relayKey}`);
    const result = await listGatewayModels(new Request("http://durindoor.invalid/v1/models", {
      headers: { authorization: `Bearer ${clients.build}` },
    }));
    expect(result.status).toBe(200);
    const ids = (await result.json()).data.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([`cpa/${appRoute}`, `cpa/${devinRoute}`]));
  });

  it("requires a gateway key scoped to a proxy connection", async () => {
    expect((await chat(`cpa/${appRoute}`)).status).toBe(401);
    expect((await chat(`cpa/${appRoute}`, clients.gemini)).ok).toBe(false);
    expect(sidecarFetch).not.toHaveBeenCalled();
  });

  it("routes JSON and SSE with usage through the selected connection", async () => {
    connectApp(`ws://127.0.0.1:8317/v1/ws?auth_token=${relayKey}`);
    const [json, buildStream, devinStream] = await Promise.all([
      chat(`cpa/${appRoute}`, clients.build),
      chat(`cpa/${appRoute}`, clients.build, true),
      chat(`cliproxyapi/${devinRoute}`, clients.devin, true),
    ]);
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      choices: [{ message: { content: "build reply" } }], usage: addBufferToUsage(usage),
    });
    for (const [stream, reply] of [[buildStream, "build reply"], [devinStream, "devin reply"]]) {
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      const events = await stream.text();
      expect(events).toContain(reply);
      expect(events).toContain(`"total_tokens":${addBufferToUsage(usage).total_tokens}`);
      expect(events).toContain("data: [DONE]");
    }
    const dispatched = sidecarFetch.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"));
    expect(dispatched.map(([, init]) => [
      JSON.parse(init.body).model, JSON.parse(init.body).stream, new Headers(init.headers).get("authorization"),
    ])).toEqual(expect.arrayContaining([
      [appRoute, false, "Bearer fixture-build"], [appRoute, true, "Bearer fixture-build"],
      [devinRoute, true, "Bearer fixture-devin"],
    ]));
    expect(dispatched).toHaveLength(3);
  });

  it.each([["build", appRoute], ["devin", devinRoute]])(
    "ends the %s stream when the sidecar disconnects after a partial reply",
    async (connection, model) => {
      let upstream;
      sidecarFetch.mockImplementation(async (url, init) => {
        expect(String(url)).toBe(`${sidecar}/v1/chat/completions`);
        expect(JSON.parse(init.body).model).toBe(model);
        expect(new Headers(init.headers).get("authorization")).toBe(`Bearer fixture-${connection}`);
        return new Response(new ReadableStream({
          start(controller) {
            upstream = controller;
            controller.enqueue(new TextEncoder().encode('data: {"id":"partial","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"partial reply"},"finish_reason":null}]}\n\n'));
          },
        }), { headers: { "content-type": "text/event-stream" } });
      });

      const response = await chat(`cpa/${model}`, clients[connection], true);
      expect(response.status).toBe(200);
      const reader = response.body.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("partial reply");
      upstream.error(new Error("sidecar disconnected"));
      const remainder = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          remainder.push(new TextDecoder().decode(chunk.value));
        }
      } catch (error) {
        expect(error.message).toContain("sidecar disconnected");
      }
      expect(remainder.join("")).not.toContain('"finish_reason":"stop"');
      expect(sidecarFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("surfaces missing relay errors without switching to Gemini CLI or another connection", async () => {
    const app = connectApp(`ws://127.0.0.1:8317/v1/ws?auth_token=${relayKey}`);
    app.disconnect();
    const result = await chat(`cpa/${appRoute}`, clients.build);
    expect(result.status).toBe(503);
    expect(await result.text()).toContain("Provider unavailable");
    expect(sidecarFetch).toHaveBeenCalled();
    for (const [url, init] of sidecarFetch.mock.calls) {
      expect(url).toBe(`${sidecar}/v1/chat/completions`);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-build");
    }
  });
});
