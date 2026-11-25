import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  core: vi.fn(),
  model: vi.fn(),
  policy: vi.fn(),
  store: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.core }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: mocks.policy }));
vi.mock("@/sse/services/model.js", async (original) => ({
  ...await original(),
  getModelInfo: mocks.model,
  getComboModels: async () => null,
  loadCustomCapabilities: async () => null,
}));
vi.mock("@/sse/services/auth.js", async (original) => ({
  ...await original(),
  getProviderCredentialsWithQuotaPreflight: async () => ({ apiKey: "fixture-upstream", connectionId: "provider-fixture" }),
}));
vi.mock("@/lib/db/repos/sessionCaptureRepo.js", async (original) => {
  const repo = await original();
  mocks.store.mockImplementation(repo.storeAdmittedCapture);
  return { ...repo, storeAdmittedCapture: mocks.store };
});

const session = "550e8400-e29b-41d4-a716-446655440000";
const owner = "fixture-client-credential";
const other = "fixture-other-credential";
const url = "http://localhost/v1";
const data = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const delta = (content, finish_reason = null) => data({ choices: [{ index: 0, delta: { content }, finish_reason }] });
const openAiEnd = delta(null, "stop") + "data: [DONE]\r\n\r\n";
const claudeEvent = (type, fields) => `event: ${type}\n${data({ type, ...fields })}`;

let dir, db, settings, chat, messages, route;
const originalDir = process.env.DATA_DIR;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "message-capture-1131-"));
  process.env.DATA_DIR = dir;
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  settings = await import("@/lib/db/repos/settingsRepo.js");
  chat = await import("@/app/api/v1/chat/completions/route.js");
  messages = await import("@/app/api/v1/messages/route.js");
  route = await import("@/app/api/v1/session-captures/[session]/route.js");
  for (const [id, key] of [["owner", owner], ["other", other]]) {
    db.run("INSERT INTO apiKeys (id, name, key, machineId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      [id, id, key, "fixture", 1, new Date().toISOString()]);
  }
});

afterAll(async () => {
  await db?.close();
  if (originalDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDir;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.core.mockReset();
  mocks.model.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
  mocks.policy.mockResolvedValue(null);
  db.run('DELETE FROM "sessionCaptureTurns"');
  db.run("UPDATE apiKeys SET isActive = 1, expiresAt = NULL");
  await settings.updateSettings({ enableSessionCapture: true, requireApiKey: false });
});

function post({ claude = false, stream = false, consent = "true", sid = session, key = owner, content = "hello", signal, authorization } = {}) {
  const headers = { "Content-Type": "application/json", "x-durindoor-capture-session": sid };
  if (consent !== null) headers["x-durindoor-capture"] = consent;
  if (key) headers["x-api-key"] = key;
  if (authorization) headers.authorization = authorization;
  return (claude ? messages : chat).POST(new Request(url + (claude ? "/messages" : "/chat/completions"), {
    method: "POST", headers, signal,
    body: JSON.stringify({
      model: "openai/gpt-4o", stream, max_tokens: 20,
      messages: [{ role: "user", content }],
    }),
  }));
}

function access(method, key = owner, query = "", sid = session) {
  const headers = key ? { "x-api-key": key } : {};
  return route[method](new Request(`${url}/session-captures/${sid}${query}`, { method, headers }), {
    params: Promise.resolve({ session: sid }),
  });
}

async function turns(key = owner) {
  const response = await access("GET", key);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return (await response.json()).turns;
}

function providerResponse(response) {
  mocks.core.mockResolvedValueOnce({ success: response.ok, response });
}

function completion(text, claude = false) {
  return claude
    ? { type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn" }
    : { choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
}

function sse(text) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else {
        controller.enqueue(bytes.subarray(offset, offset + 3));
        offset = Math.min(bytes.length, offset + 3);
      }
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

describe("opt-in message capture through the public chat routes", () => {
  it("requires both switches, a UUID and an admitted stored identity", async () => {
    await settings.updateSettings({ enableSessionCapture: false });
    providerResponse(Response.json(completion("reply")));
    expect((await (await post()).json()).choices[0].message.content).toBe("reply");
    await settings.updateSettings({ enableSessionCapture: true });
    for (const options of [{ consent: null }, { consent: "false" }, { sid: "bad" }, { key: null }, { key: "local-placeholder" }]) {
      providerResponse(Response.json(completion("reply")));
      expect((await (await post(options)).json()).choices[0].message.content).toBe("reply");
    }
    expect(mocks.store).not.toHaveBeenCalled();
    expect(await turns()).toEqual([]);
  });

  it("does not persist an imported UUID credential as the session ID", async () => {
    db.run("UPDATE apiKeys SET key = ? WHERE id = ?", [session, "owner"]);
    try {
      providerResponse(Response.json(completion("reply")));
      expect((await (await post({ key: session })).json()).choices[0].message.content).toBe("reply");
      expect(mocks.store).not.toHaveBeenCalled();
    } finally {
      db.run("UPDATE apiKeys SET key = ? WHERE id = ?", [owner, "owner"]);
    }
  });

  it.each([false, true])("captures successful JSON (Anthropic: %s) without rewriting the response", async (claude) => {
    const payload = completion(`reply ${owner} fixture-stale-client Bearer hidden-bearer sk-hidden sk_hidden AIzaHidden eyJhbGciOiJIUzI1NiJ9.e30.signature -----BEGIN RSA PRIVATE KEY-----\nprivate-material\n-----END RSA PRIVATE KEY----- https://fixture.invalid/?token=hidden-query`, claude);
    providerResponse(Response.json(payload));
    const response = await post({ claude, sid: session.toUpperCase(), authorization: "Bearer fixture-stale-client" });
    expect(await response.json()).toEqual(payload);
    await vi.waitFor(async () => expect(await turns()).toHaveLength(1));
    const [row] = await turns();
    expect(row.content).toEqual({
      user: ["hello"], assistant: ["reply [redacted] [redacted] Bearer [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] https://fixture.invalid/?token=%5Bredacted%5D"],
    });
    expect(mocks.core.mock.calls[0][0].clientRawRequest.headers).not.toHaveProperty("x-durindoor-capture-session");
    expect(mocks.store.mock.calls[0][0]).toEqual({
      keyId: "owner", session, billingEpoch: null, content: JSON.stringify(row.content),
    });
  });

  it.each([false, true])("captures complete SSE with split UTF-8 and split secrets (Anthropic: %s)", async (claude) => {
    const text = claude
      ? claudeEvent("message_start", { message: { role: "assistant", content: [] } }) +
        claudeEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        claudeEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "café Bear" } }) +
        claudeEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "er stream-secret" } }) +
        claudeEvent("content_block_stop", { index: 0 }) +
        claudeEvent("content_block_start", { index: 1, content_block: { type: "tool_use", name: "fixture" } }) +
        claudeEvent("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "tool payload" } }) +
        claudeEvent("content_block_stop", { index: 1 }) +
        claudeEvent("message_delta", { delta: { stop_reason: "end_turn" } }) +
        claudeEvent("message_stop", {})
      : delta("café Bear") + delta("er stream-secret") + openAiEnd;
    providerResponse(sse(text));
    expect(await (await post({ claude, stream: true })).text()).toBe(text);
    await vi.waitFor(async () => expect(await turns()).toHaveLength(1));
    expect((await turns())[0].content).toEqual({ user: ["hello"], assistant: ["café Bearer [redacted]"], ...(claude ? { toolNames: ["fixture"] } : {}) });
  });

  it("skips denied, partial, errored and oversized responses", async () => {
    mocks.policy.mockResolvedValueOnce(Response.json({ error: "denied" }, { status: 403 }));
    expect((await post()).status).toBe(403);
    expect(mocks.core).not.toHaveBeenCalled();
    for (const text of [
      delta("partial"),
      delta("partial") + data({ error: { message: "error" } }) + openAiEnd,
      delta("é".repeat(8500)) + openAiEnd,
    ]) {
      providerResponse(sse(text));
      expect(await (await post({ stream: true })).text()).toBe(text);
    }
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("cancels upstream on disconnect without saving a partial turn", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const body = new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode(delta("partial"))); },
      cancel: cancelled,
    });
    providerResponse(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    const response = await post({ stream: true, signal: controller.signal });
    const reader = response.body.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await reader.cancel();
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("leaves status, headers and body intact when capture storage fails", async () => {
    mocks.store.mockRejectedValueOnce(new Error("fixture storage error"));
    providerResponse(Response.json(completion("reply"), { headers: { "x-fixture": "preserved" } }));
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-fixture")).toBe("preserved");
    expect(await response.json()).toEqual(completion("reply"));
    expect(mocks.store).toHaveBeenCalledOnce();
    expect(await turns()).toEqual([]);
  });

  it("scopes bounded reads and deletes to the admitted key, including after disablement", async () => {
    for (const key of [owner, other]) {
      providerResponse(Response.json(completion(key === owner ? "owner reply" : "other reply")));
      await (await post({ key })).text();
    }
    await vi.waitFor(async () => {
      expect(await turns(owner)).toHaveLength(1);
      expect(await turns(other)).toHaveLength(1);
    });
    await settings.updateSettings({ enableSessionCapture: false });
    expect((await access("GET", null)).status).toBe(401);
    expect((await access("DELETE", null)).status).toBe(401);
    expect((await access("GET", owner, "?limit=101")).status).toBe(400);
    expect((await access("GET", owner, "?limit=1&limit=2")).status).toBe(400);
    expect((await access("DELETE", owner, "", "bad")).status).toBe(400);
    const limited = await access("GET", owner, "?limit=1");
    expect((await limited.json()).turns[0].content.assistant).toEqual(["owner reply"]);
    expect((await access("DELETE", other)).status).toBe(204);
    expect(await turns(other)).toEqual([]);
    expect(await turns(owner)).toHaveLength(1);
    db.run("UPDATE apiKeys SET isActive = 0 WHERE id = ?", ["owner"]);
    expect((await access("GET")).status).toBe(401);
    expect((await access("DELETE")).status).toBe(401);
    db.run("UPDATE apiKeys SET isActive = 1, expiresAt = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", "owner"]);
    expect((await access("GET")).status).toBe(401);
    expect((await access("DELETE")).status).toBe(401);
  });

  it("drops a completion when the admitted key is revoked before stream completion", async () => {
    providerResponse(sse(delta("completed") + openAiEnd));
    const response = await post({ stream: true });
    db.run("UPDATE apiKeys SET isActive = 0 WHERE id = ?", ["owner"]);
    expect(await response.text()).toBe(delta("completed") + openAiEnd);
    expect(mocks.store).toHaveBeenCalledOnce();
    await expect(mocks.store.mock.results[0].value).rejects.toThrow("Authentication required");
    expect(db.get('SELECT COUNT(*) AS count FROM "sessionCaptureTurns"').count).toBe(0);
  });
});
