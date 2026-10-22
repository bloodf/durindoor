import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transport: vi.fn(), credentials: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true }),
  getApiKeyById: async (id) => ({ id, key: `fixture-${id}` }),
  getApiKeyByKey: async () => null,
  getApiKeyUsageLimitStatus: async () => ({ exceeded: false }),
  saveRequestUsage: async () => true,
}));
vi.mock("@/sse/services/auth", () => ({
  resolveClientApiKey: async (request) => {
    const id = request.headers.get("authorization")?.replace(/^Bearer /, "");
    return { apiKey: `fixture-${id}`, auth: { ok: true, stored: true, apiKeyId: id, operator: id === "operator" } };
  },
  getProviderCredentialsWithQuotaPreflight: mocks.credentials,
}));
vi.mock("@/sse/services/apiKeyPolicy", () => ({ enforceApiKeyModelPolicy: async () => null }));
vi.mock("@/sse/services/model", () => ({
  getModelInfo: async (identity) => ({ provider: identity.split("/")[0], model: identity.split("/")[1] }),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.transport }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({ resolveCredentialProxyOptions: () => ({}) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "fixture/offline", updateKimchiUserAgent: async () => "fixture/offline" }));

// Block accidental fetch/refresh traffic before importing any application module.
// Loopback HTTP below uses node:http; provider transport and quota admission are fake.
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch forbidden in ownership fixture"); }));
if (!process.env.DATA_DIR || process.env.NODE_ENV !== "test") throw new Error("Run through the isolated scoped-test wrapper");
const route = await import("@/app/api/v1/native/[provider]/[...operation]/route.js");
const { readNativeResourceOwner, createNativeResourceOwner } = await import("@/sse/services/nativeResourceOwners.js");
const { observeNativeResponse } = await import("@/sse/services/nativeUsage.js");

const model = "claude-haiku-4-5";
const connectionId = "fixture-account";
let server;
let baseUrl;
const bridgeErrors = [];

beforeAll(async () => {
  mocks.credentials.mockResolvedValue({ connectionId, apiKey: "fixture-vendor-not-a-real-secret", providerSpecificData: {} });
  // Exercise real route exports over HTTP, without a Next build or external ingress.
  server = createServer(async (incoming, outgoing) => {
    let reader;
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request(new URL(incoming.url, baseUrl), {
        method: incoming.method, headers: incoming.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const operation = new URL(request.url).pathname.slice("/api/v1/native/anthropic/".length).split("/");
      const response = await route[incoming.method](request, { params: Promise.resolve({ provider: "anthropic", operation }) });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { outgoing.end(); return; }
      reader = response.body.getReader();
      outgoing.on("close", () => {
        if (!outgoing.writableEnded) reader.cancel("HTTP client disconnected").catch((error) => bridgeErrors.push(error));
      });
      while (!outgoing.destroyed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!outgoing.write(value)) await once(outgoing, "drain");
      }
      if (!outgoing.destroyed) outgoing.end();
    } catch (error) {
      bridgeErrors.push(error);
      outgoing.destroy(error);
    } finally {
      reader?.releaseLock();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  expect(bridgeErrors).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function send(method, path, principal = "creator", body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/v1/native/anthropic${path}`, baseUrl);
    url.searchParams.set("model", `anthropic/${model}`);
    const request = httpRequest(url, {
      method, agent: false,
      headers: { authorization: `Bearer ${principal}`, "x-connection-id": connectionId, "content-type": "application/json" },
    }, resolve);
    request.on("error", reject);
    request.end(body === undefined || method === "DELETE" || method === "GET" ? undefined : JSON.stringify(body));
  });
}

async function consume(method, path, principal = "creator", body) {
  const response = await send(method, path, principal, body);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return { status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") };
}

function creationFixture(id, holdEof) {
  let cancelled = false;
  let eof = false;
  const bytes = Buffer.from(JSON.stringify({ id, type: "fixture-resource" }));
  const response = new Response(new ReadableStream({
    start(controller) {
      // A complete, parseable JSON document is not transport EOF.
      controller.enqueue(bytes);
      if (!holdEof) { eof = true; controller.close(); }
    },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } });
  mocks.transport.mockImplementationOnce(async () => response);
  return { bytes, get cancelled() { return cancelled; }, get eof() { return eof; } };
}

function owner(id) { return readNativeResourceOwner("anthropic", connectionId, id); }
function expectedOwner(id) { return { ownerId: "creator", provider: "anthropic", model, connectionId, resourceId: id }; }

describe("shared JSON ownership byte boundary", () => {
  it("waits for persistence before releasing a split ID and completes exactly once without reframing bytes", async () => {
    const id = `resource-${randomUUID()}`;
    const chunks = [Buffer.from('{"id":"'), Buffer.from(`${id}","type":"fixture"}`)];
    let release;
    const persisted = new Promise((resolve) => { release = resolve; });
    const onValue = vi.fn(async (value) => {
      if (value.id) {
        await persisted;
        await createNativeResourceOwner(expectedOwner(value.id));
      }
    });
    const onComplete = vi.fn();
    const source = new Response(new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    }), { headers: { "content-type": "application/json" } });
    const reader = observeNativeResponse(source, { onValue, onComplete }).body.getReader();
    expect(Buffer.from((await reader.read()).value).equals(chunks[0])).toBe(true);
    let delivered = false;
    const next = reader.read().then((value) => { delivered = true; return value; });
    try {
      await vi.waitFor(() => expect(onValue).toHaveBeenCalledWith(expect.objectContaining({ id })));
      expect(delivered).toBe(false);
      expect(await owner(id)).toBeNull();
      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      release();
    }
    expect(Buffer.from((await next).value).equals(chunks[1])).toBe(true);
    expect(await owner(id)).toEqual(expectedOwner(id));
    expect((await reader.read()).done).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not release an ID-bearing chunk when ownership persistence fails", async () => {
    const id = `resource-${randomUUID()}`;
    const source = Response.json({ id });
    const onComplete = vi.fn();
    const reader = observeNativeResponse(source, {
      onValue: async () => { throw new Error("fixture ownership persistence failed"); }, onComplete,
    }).body.getReader();
    await expect(reader.read()).rejects.toThrow("fixture ownership persistence failed");
    expect(onComplete).not.toHaveBeenCalled();
    expect(await owner(id)).toBeNull();
  });
});

const lifecycles = [
  { collection: "/v1/files", createBody: { purpose: "fixture" }, mutateMethod: "DELETE", suffix: "" },
  {
    collection: "/v1/messages/batches",
    createBody: { requests: [{ custom_id: "fixture", params: { model: `anthropic/${model}`, max_tokens: 1, messages: [{ role: "user", content: "fixture" }] } }] },
    mutateMethod: "POST", suffix: "/cancel",
  },
];

describe.each(lifecycles)("PR1271 HTTP $collection creation lifecycle", ({ collection, createBody, mutateMethod, suffix }) => {
  it("persists ownership before usable JSON ID bytes and retains it after HTTP client cancellation before EOF", async () => {
    const id = `resource-${randomUUID()}`;
    const fixture = creationFixture(id, true);
    const response = await send("POST", collection, "creator", createBody);
    let beforeCancel;
    let received = Buffer.alloc(0);
    try {
      for await (const chunk of response) {
        received = Buffer.concat([received, chunk]);
        if (received.length >= fixture.bytes.length) {
          // Observe disk while client still holds the live HTTP response.
          beforeCancel = await owner(id);
          break;
        }
      }
    } finally {
      response.destroy();
    }
    await vi.waitFor(() => expect(fixture.cancelled).toBe(true));
    expect(response.statusCode).toBe(200);
    expect(received.equals(fixture.bytes)).toBe(true);
    expect(JSON.parse(received.toString("utf8")).id).toBe(id);
    expect(fixture.eof).toBe(false);
    const afterCancel = await owner(id);
    mocks.transport.mockImplementation(async () => Response.json({ id, deleted: true, processing_status: "canceling" }));
    const dispatchedBefore = mocks.transport.mock.calls.length;
    const mutation = await consume(mutateMethod, `${collection}/${id}${suffix}`, "creator", {});
    const dispatchedAfter = mocks.transport.mock.calls.length;
    const operator = await consume("GET", `${collection}/${id}`, "operator");
    // Ordinary RED assertions: never mark this defect expected-to-fail.
    expect.soft(beforeCancel, "owner must be durable before client receives a usable ID").toEqual(expectedOwner(id));
    expect.soft(afterCancel, "HTTP cancellation must not orphan an upstream-created resource").toEqual(expectedOwner(id));
    expect.soft(mutation.status, "creator mutation after early client cancellation").toBe(200);
    expect.soft(dispatchedAfter - dispatchedBefore, "creator mutation must reach fake provider once").toBe(1);
    expect.soft(operator.status, "operator can use recorded owners, not repair an unknown owner implicitly").toBe(200);
  });

  it("fully consumed creation permits creator mutation, denies foreign owners, and keeps operator unknown-owner fail-closed", async () => {
    const id = `resource-${randomUUID()}`;
    const fixture = creationFixture(id, false);
    const created = await consume("POST", collection, "creator", createBody);
    expect(created.status).toBe(200);
    expect(created.text).toBe(fixture.bytes.toString("utf8"));
    expect(created.headers["x-9router-connection-id"]).toBe(connectionId);
    expect(await owner(id)).toEqual(expectedOwner(id));
    mocks.transport.mockImplementation(async () => Response.json({ id, deleted: true, processing_status: "canceling" }));
    const beforeForeign = mocks.transport.mock.calls.length;
    expect((await consume(mutateMethod, `${collection}/${id}${suffix}`, "foreign", {})).status).toBe(403);
    expect(mocks.transport.mock.calls.length).toBe(beforeForeign);
    expect((await consume(mutateMethod, `${collection}/${id}${suffix}`, "creator", {})).status).toBe(200);
    expect(mocks.transport.mock.calls.length).toBe(beforeForeign + 1);
    expect(await owner(id)).toEqual(expectedOwner(id));
    expect((await consume(mutateMethod, `${collection}/${id}${suffix}`, "operator", {})).status).toBe(200);
    expect(mocks.transport.mock.calls.length).toBe(beforeForeign + 2);
    const beforeUnknown = mocks.transport.mock.calls.length;
    const unknown = `unknown-${randomUUID()}`;
    expect((await consume(mutateMethod, `${collection}/${unknown}${suffix}`, "operator", {})).status).toBe(403);
    expect(mocks.transport.mock.calls.length).toBe(beforeUnknown);
    expect(await owner(unknown)).toBeNull();
    // Batch cancel and DELETE both preserve the original owner's durable record.
    if (suffix) {
      expect((await consume("DELETE", `${collection}/${id}`, "creator")).status).toBe(200);
      expect(await owner(id)).toEqual(expectedOwner(id));
    }
    expect(fixture.cancelled).toBe(false);
  });
});
