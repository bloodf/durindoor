import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const { recordApiKeyUsage } = vi.hoisted(() => ({ recordApiKeyUsage: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
}));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  recordApiKeyUsage,
  enforceApiKeyModelPolicy: vi.fn(),
}));
vi.mock("@/lib/dataDir.js", () => ({
  get DATA_DIR() { return ownerStorage.directory; },
  getDataDir: () => ownerStorage.directory,
}));
const ownerStorage = vi.hoisted(() => ({ directory: null }));
const billing = vi.hoisted(() => ({ epoch: null }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getBillingEpoch: async () => billing.epoch }));

import { observeNativeResponse } from "@/sse/services/nativeUsage.js";

const details = {
  provider: "minimax", connectionId: "account-a", model: "speech",
  endpoint: "/v1/voice_clone", tokens: {}, cost: 1,
  costStatus: "known", costSource: "provider", modality: "tts",
  nativeUnits: { characters: 10 },
  billingEpoch: null,
};
const jsonResponse = (body) => new Response(JSON.stringify(body), {
  headers: { "content-type": "application/json" },
});
const recordedIds = () => recordApiKeyUsage.mock.calls.map(([, entry]) => entry.usageEventId);

beforeEach(() => {
  recordApiKeyUsage.mockReset();
  billing.epoch = null;
});

describe("native resource billing identity", () => {
  it("persists legacy identity and preserves caller identity without cross-owner replacement", async () => {
    ownerStorage.directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-identity-"));
    try {
      const owners = await import("@/sse/services/nativeResourceOwners.js");
      const owner = { ownerId: "creator-a", provider: "openai", connectionId: "conn-a", resourceId: "resp-a", billingEpoch: null };
      await owners.createNativeResourceOwner(owner);
      const migrated = await owners.readNativeResourceOwner("openai", "conn-a", "resp-a");
      expect(migrated.usageEventId).toBe("openai:conn-a:resp-a:terminal");
      const filename = createHash("sha256").update("openai\0conn-a\0resp-a").digest("hex") + ".json";
      expect(JSON.parse(fs.readFileSync(path.join(ownerStorage.directory, "native-resource-owners", filename), "utf8"))).toEqual(migrated);
      await owners.createNativeResourceOwner({ ...owner, ownerId: "creator-b", usageEventId: "other-operation" });
      expect(await owners.readNativeResourceOwner("openai", "conn-a", "resp-a")).toEqual(migrated);
      expect(await owners.readNativeResourceOwner("openai", "conn-b", "resp-a")).toBeNull();
      const explicit = { ...owner, resourceId: "resp-b", usageEventId: "caller-operation" };
      await owners.createNativeResourceOwner(explicit);
      expect(await owners.readNativeResourceOwner("openai", "conn-a", "resp-b")).toEqual(explicit);
      await owners.createNativeResourceOwner({ ...owner, connectionId: "conn:a" });
      expect(await owners.readNativeResourceOwner("openai", "conn:a", "resp-a")).toBeNull();
    } finally {
      fs.rmSync(ownerStorage.directory, { recursive: true, force: true });
    }
  });

  it("rejects pre-cutover owners and delayed creation without replacing legacy operation IDs", async () => {
    ownerStorage.directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-cutover-"));
    try {
      const owners = await import("@/sse/services/nativeResourceOwners.js");
      const owner = { ownerId: "creator-a", provider: "openai", connectionId: "conn-a", resourceId: "resp-a", usageEventId: "legacy-operation", billingEpoch: null };
      await owners.createNativeResourceOwner(owner);
      const inflight = await owners.readNativeResourceOwner("openai", "conn-a", "resp-a");
      billing.epoch = "cutover-a";
      expect(await owners.readNativeResourceOwner("openai", "conn-a", "resp-a")).toBeNull();
      await expect(owners.createNativeResourceOwner(inflight)).rejects.toThrow("Stale or missing billing epoch");
      await expect(owners.createNativeResourceOwner({ ...owner, billingEpoch: undefined })).rejects.toThrow("Stale or missing billing epoch");
      const current = { ...owner, billingEpoch: billing.epoch, usageEventId: "new-operation" };
      await owners.createNativeResourceOwner(current);
      expect(await owners.readNativeResourceOwner("openai", "conn-a", "resp-a")).toEqual(current);
      billing.epoch = null;
      expect(await owners.readNativeResourceOwner("openai", "conn-a", "resp-a")).toEqual(owner);
    } finally {
      fs.rmSync(ownerStorage.directory, { recursive: true, force: true });
    }
  });
});

describe("native observer logical event identity", () => {
  it("does not charge old in-flight completion after cutover and charges a new operation once", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-ledger-cutover-"));
    ownerStorage.directory = directory;
    const names = ["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"];
    const originalEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
    const listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
    const previousAdapter = global._dbAdapter;
    let adapter;
    try {
      process.env.DATA_DIR = directory;
      process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
      delete process.env.DURINDOOR_PG_URL;
      delete global._dbAdapter;
      vi.resetModules();
      const { getAdapter } = await import("@/lib/db/driver.js");
      adapter = await getAdapter();
      const { saveRequestUsage } = await vi.importActual("@/lib/db/repos/usageRepo.js");
      recordApiKeyUsage.mockImplementation((_apiKey, entry) => saveRequestUsage({ ...entry, strict: true }));
      let upstream;
      const source = new Response(new ReadableStream({ start(controller) { upstream = controller; } }), {
        headers: { "content-type": "text/event-stream" },
      });
      const reader = observeNativeResponse(source, { ...details, usageEventId: "operation" }).body.getReader();
      upstream.enqueue(new TextEncoder().encode('data: {"type":"response.completed","usage":{"input_tokens":3}}\n\n'));
      await reader.read();
      adapter.run("INSERT INTO kv(scope, key, value) VALUES('billing', 'epoch', ?)", [JSON.stringify("cutover-a")]);
      upstream.close();
      await expect(reader.read()).rejects.toThrow("Stale or missing billing epoch");
      expect(adapter.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
      for (const billingEpoch of [undefined, null, "stale"]) {
        await expect(observeNativeResponse(jsonResponse({}), { ...details, usageEventId: "missing", billingEpoch }).text()).rejects.toThrow("Stale or missing billing epoch");
      }
      for (let retry = 0; retry < 2; retry++) {
        await observeNativeResponse(jsonResponse({ usage: { input_tokens: 3 } }), {
          ...details, usageEventId: "operation", billingEpoch: "cutover-a",
        }).text();
      }
      expect(adapter.all("SELECT cost, promptTokens FROM usageHistory")).toEqual([{ cost: 1, promptTokens: 3 }]);
    } finally {
      await adapter?.close?.();
      if (previousAdapter === undefined) delete global._dbAdapter;
      else global._dbAdapter = previousAdapter;
      for (const [name, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      for (const signal of signals) {
        for (const listener of process.listeners(signal)) {
          if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
        }
      }
      vi.resetModules();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["id", "task_id", "request_id", "voice_id", "file_id"])(
    "preserves distinct operations and retry identity despite shared %s",
    async (field) => {
      for (const usageEventId of ["operation-a", "operation-b", "operation-a"]) {
        await observeNativeResponse(jsonResponse({ [field]: "shared-resource" }), {
          ...details, resourceId: "shared-resource", usageEventId,
          billableOperationId: "ignored-fallback",
        }).text();
      }
      // Cross-response deduplication belongs to the ledger; retries must reach it
      // with the same logical ID, while separate operations must remain distinct.
      expect(recordedIds()).toEqual(["operation-a", "operation-b", "operation-a"]);
    },
  );

  it("scopes an explicitly documented billing operation without using resource IDs", async () => {
    for (const overrides of [{}, {}, { connectionId: "account-b" }, { endpoint: "/v1/voice_design" }, { provider: "minimax-cn" }]) {
      await observeNativeResponse(jsonResponse({ id: "unrelated-resource" }), {
        ...details, billableOperationId: "billable-job", ...overrides,
      }).text();
    }
    const ids = recordedIds();
    expect(ids[0]).toBe(JSON.stringify(["minimax", "account-a", "/v1/voice_clone", "billable-job", "terminal"]));
    expect(ids[1]).toBe(ids[0]);
    expect(new Set(ids).size).toBe(4);
  });

  it.each(["id", "task_id", "request_id", "voice_id", "file_id"])(
    "fails closed instead of treating %s as a billing identity", async (field) => {
      await expect(observeNativeResponse(jsonResponse({ [field]: "resource-only" }), {
        ...details, resourceId: "resource-only",
      }).text()).rejects.toThrow("Native usage requires usageEventId");
      expect(recordApiKeyUsage).not.toHaveBeenCalled();
    },
  );

  it.each(["provider", "connectionId", "endpoint"])("rejects fallback without %s scope", async (field) => {
    await expect(observeNativeResponse(jsonResponse({}), {
      ...details, billableOperationId: "job", [field]: undefined,
    }).text()).rejects.toThrow("Native usage requires usageEventId");
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
  });

  it("commits once after a native terminal and clean EOF, retaining caller identity", async () => {
    const terminal = 'data: {"type":"response.completed","response":{"id":"shared-resource","usage":{"input_tokens":3,"output_tokens":5}}}\n\n';
    let upstream;
    const source = new Response(new ReadableStream({ start(controller) { upstream = controller; } }), {
      headers: { "content-type": "text/event-stream" },
    });
    const reader = observeNativeResponse(source, { ...details, usageEventId: "stream-operation", terminalOnly: true }).body.getReader();
    upstream.enqueue(new TextEncoder().encode('data: {"type":"response.created","id":"shared-resource"}\n\n'));
    await reader.read();
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
    upstream.enqueue(new TextEncoder().encode(terminal));
    await reader.read();
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
    upstream.enqueue(new TextEncoder().encode(terminal));
    await reader.read();
    upstream.close();
    expect((await reader.read()).done).toBe(true);
    expect(recordedIds()).toEqual(["stream-operation"]);
    expect(recordApiKeyUsage.mock.calls[0][1].tokens).toMatchObject({ input_tokens: 3, output_tokens: 5 });
  });

  it.each([
    'data: {"type":"response.output_item.done","usage":{"input_tokens":3}}\n\n',
    'data: {"type":"response.created"}\n\n',
    'data: {"type":"response.completed"}',
    'data: {"type":"error","error":{"message":"failed"}}\n\ndata: {"type":"message_stop"}\n\n',
    'event: error\ndata: {"message":"failed"}\n\ndata: {"type":"message_stop"}\n\n',
    'data: {"type":"response.done","response":{"status":"failed"}}\n\n',
    'data: {"type":"response.completed"}\n\nevent: error\ndata: {"message":"failed"}\n\n',
  ])("does not commit unsuccessful or truncated stream: %s", async (body) => {
    const onComplete = vi.fn();
    await observeNativeResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), {
      ...details, usageEventId: "unfinished", onComplete,
    }).text();
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each([{ error: { message: "failed" } }, { base_resp: { status_code: 1001 } }, { status: "failed" }])(
    "does not treat HTTP 200 error envelopes as success: %j", async (body) => {
      const onComplete = vi.fn();
      await observeNativeResponse(jsonResponse(body), { ...details, usageEventId: "error", onComplete }).text();
      expect(recordApiKeyUsage).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    },
  );

  it("waits past item done and keeps the final USD receipt and caller native units", async () => {
    const body = 'data: {"type":"response.output_item.done","usage":{"input_tokens":1,"cost_usd":0.1}}\n\n' +
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"cost_usd":0.75}}}\n\n';
    const onComplete = vi.fn();
    await observeNativeResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), {
      ...details, usageEventId: "final-receipt", onComplete,
    }).text();
    expect(recordApiKeyUsage).toHaveBeenCalledExactlyOnceWith(undefined, expect.objectContaining({
      usageEventId: "final-receipt", cost: 0.75, costStatus: "known", costSource: "provider",
      tokens: expect.objectContaining({ input_tokens: 3 }), nativeUnits: { characters: 10 },
    }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("waits for the chat protocol terminator after its usage chunk", async () => {
    const chunk = 'data: {"object":"chat.completion.chunk","usage":{"input_tokens":3}}\n\n';
    for (const body of [chunk, chunk + 'data: [DONE]\n\n']) {
      await observeNativeResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), {
        ...details, usageEventId: "chat-terminal",
      }).text();
    }
    expect(recordedIds()).toEqual(["chat-terminal"]);
  });


  it.each([
    [{ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 } }],
    [{ candidates: [{ finishReason: "MAX_TOKENS" }] }],
    [{ candidates: [{ finishReason: "SAFETY" }, { finishReason: "STOP" }] }],
    [{ candidates: [{ finishReason: "STOP" }, { finishReason: "RECITATION" }] }],
    [{ candidates: [{ finishReason: "STOP" }] }, { candidates: [{ finishReason: "OTHER" }] }],
    [{ candidates: [{ finishReason: "STOP" }] }, { error: { message: "failed" } }],
    [{ promptFeedback: { blockReason: "SAFETY" } }],
    [{ type: "custom.done" }],
    [{ candidates: [{ content: { finishReason: "STOP" } }] }],
  ].map((events) => [events]))("does not charge unsuccessful Gemini SSE: %j", async (events) => {
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    await observeNativeResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }), {
      ...details, provider: "gemini", usageEventId: "gemini-failed",
    }).text();
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
  });

  it.each(["error", "cancel", "truncated"])("does not charge Gemini STOP followed by %s", async (ending) => {
    let upstream;
    const source = new Response(new ReadableStream({ start(controller) { upstream = controller; } }), {
      headers: { "content-type": "text/event-stream" },
    });
    const reader = observeNativeResponse(source, { ...details, provider: "gemini", usageEventId: "gemini-aborted" }).body.getReader();
    upstream.enqueue(new TextEncoder().encode('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'));
    await reader.read();
    if (ending === "error") {
      upstream.error(new Error("aborted"));
      await expect(reader.read()).rejects.toThrow("aborted");
    } else if (ending === "cancel") {
      await reader.cancel();
    } else {
      upstream.enqueue(new TextEncoder().encode('data: {"usageMetadata":{"totalTokenCount":8}}'));
      await reader.read();
      upstream.close();
      expect((await reader.read()).done).toBe(true);
    }
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
  });

  it.each([
    ["minimax", "/v1/t2a_v2", { data: { status: 2 } }, true],
    ["minimax-cn", "/v1/music_generation", { data: { status: 2 } }, true],
    ["minimax", "/v2/query/video_generation", { status: "Success" }, true],
    ["minimax", "/v1/query/t2a_async_query_v2", { status: "Success" }, true],
    ["openai", "/v1/t2a_v2", { data: { status: 2 } }, false],
    ["minimax", "/v1/voice_clone", { status: 2 }, false],
    ["minimax", "/v1/t2a_v2", { data: { status: 1 } }, false],
  ])("limits provider completion to proven contracts: %s %s %j", async (provider, endpoint, body, success) => {
    await observeNativeResponse(jsonResponse(body), {
      ...details, provider, endpoint, terminalOnly: true, usageEventId: "provider-terminal",
    }).text();
    expect(recordedIds()).toEqual(success ? ["provider-terminal"] : []);
  });

  it.each(["response.created", "response.completed"])("does not commit an aborted stream after %s", async (type) => {
    let upstream;
    const source = new Response(new ReadableStream({ start(controller) { upstream = controller; } }), {
      headers: { "content-type": "text/event-stream" },
    });
    const onComplete = vi.fn();
    const reader = observeNativeResponse(source, { ...details, usageEventId: "aborted", onComplete }).body.getReader();
    upstream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type })}\n\n`));
    await reader.read();
    upstream.error(new Error("aborted"));
    await expect(reader.read()).rejects.toThrow("aborted");
    expect(recordApiKeyUsage).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("propagates terminal ledger failure and preserves identity on retry", async () => {
    recordApiKeyUsage.mockRejectedValueOnce(new Error("ledger unavailable"));
    const terminal = 'data: {"type":"response.completed","id":"shared-resource"}\n\n';
    const observe = () => observeNativeResponse(new Response(terminal, {
      headers: { "content-type": "text/event-stream" },
    }), { ...details, usageEventId: "retry-operation", terminalOnly: true });
    await expect(observe().text()).rejects.toThrow("ledger unavailable");
    expect(await observe().text()).toBe(terminal);
    expect(recordedIds()).toEqual(["retry-operation", "retry-operation"]);
  });

  it("preserves operation identity when invalid usage fails and a corrected retry arrives", async () => {
    const writeUsage = vi.fn();
    recordApiKeyUsage.mockImplementation(async (_apiKey, entry) => {
      if (!Number.isFinite(entry.tokens.input_tokens) || entry.tokens.input_tokens < 0) {
        throw new TypeError("Usage token counts must be finite nonnegative numbers");
      }
      writeUsage(entry);
    });
    const input = { ...details, usageEventId: "corrected-operation", fallbackUsage: { input_tokens: 8 } };
    await expect(observeNativeResponse(jsonResponse({ usage: { input_tokens: -1 } }), input).text()).rejects.toThrow("Usage token counts");
    expect(recordApiKeyUsage.mock.calls[0][1]).toMatchObject({
      usageEventId: "corrected-operation", tokens: { input_tokens: -1 },
    });
    expect(writeUsage).not.toHaveBeenCalled();
    const corrected = jsonResponse({ usage: { input_tokens: 3 } });
    await expect(observeNativeResponse(corrected, input).text()).resolves.toContain('"input_tokens":3');
    expect(recordedIds()).toEqual(["corrected-operation", "corrected-operation"]);
    expect(writeUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      usageEventId: "corrected-operation", tokens: { input_tokens: 3 },
    }));
  });
});
