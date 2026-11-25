import "../translator/registerAll.js";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/0.1.01",
  updateKimchiUserAgent: vi.fn(),
}));
vi.mock("@/dashboardGuard", async (original) => ({
  ...await original(),
  isOperatorRequest: vi.fn(),
}));
vi.mock("@/lib/localDb", async (original) => ({
  ...await original(),
  createProviderConnection: vi.fn(async (data) => ({ ...data, id: "offline" })),
}));
vi.mock("@/lib/localDb", async (original) => ({
  ...await original(),
  getProviderConnections: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/usageDb.js", () => ({
  recordTokenSaverEvent: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { spawn } from "node:child_process";
import { POST, canDiscoverModels } from "@/app/api/providers/route.js";
import { POST as validate } from "@/app/api/providers/validate/route.js";
import { isOperatorRequest } from "@/dashboardGuard";
import { createProviderConnection } from "@/lib/localDb";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";
import { getExecutor } from "open-sse/executors/index.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { parseModel } from "open-sse/services/model.js";
import { isPaidModel } from "open-sse/providers/pricing.js";
import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";
import { getProviderConnections } from "@/lib/localDb";
import { getProviderCredentials, providerAllowsPublicNoAuthFallback } from "@/sse/services/auth.js";

const PROVIDER = "devin-cli-agentic";
const MODEL = "adaptive";
const body = { messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] };
const outbound = vi.fn(async () => { throw new Error("Unexpected outbound request"); });
let home;
let restoreFetch;

beforeEach(() => {
  vi.clearAllMocks();
  spawn.mockReset();
  home = mkdtempSync(path.join(tmpdir(), "devin-acp-test-"));
  vi.stubEnv("DEVIN_AGENTIC_HOME", home);
  vi.stubEnv("CLI_DEVIN_BIN", "/offline/devin");
  vi.stubEnv("WINDSURF_API_KEY", "must-not-inherit");
  vi.stubEnv("GITHUB_TOKEN", "must-not-inherit");
  vi.stubGlobal("fetch", outbound);
  restoreFetch = __setOriginalFetchForTesting(outbound);
});

afterEach(() => {
  try {
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    restoreFetch();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

function fakeClient(onRequest = () => {}) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin.write = vi.fn((line) => onRequest(JSON.parse(line)));
  child.stdin.end = vi.fn();
  child.kill = vi.fn();
  child.send = (message) => {
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`));
  };
  child.update = (update, sessionId = "isolated-session") => {
    child.send({ method: "session/update", params: { sessionId, update } });
  };
  child.requests = () => child.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
  spawn.mockReturnValueOnce(child);
  return child;
}

function openSession(child) {
  child.send({ id: 1, result: { protocolVersion: 1 } });
  child.send({ id: 2, result: { sessionId: "isolated-session" } });
}

function requestConnection(apiKey) {
  return POST(new Request("http://localhost/api/providers", {
    method: "POST",
    body: JSON.stringify({ provider: PROVIDER, name: "Offline CLI", apiKey }),
  }));
}

describe("Devin CLI agentic", () => {
  it("resolves the distinct catalog and requires an operator-created keyless connection", async () => {
    expect(parseModel("dva/adaptive")).toMatchObject({ provider: PROVIDER, model: MODEL });
    expect(parseModel("devin-cli-agentic/adaptive")).toMatchObject({ provider: PROVIDER, model: MODEL });
    expect(getExecutor("dva")).toBe(getExecutor(PROVIDER));
    expect(getExecutor(PROVIDER)).not.toBe(getExecutor("devin-cli"));
    expect(providerAllowsPublicNoAuthFallback(PROVIDER)).toBe(false);
    expect(isPaidModel("dva/adaptive")).toBe(true);

    isOperatorRequest.mockResolvedValue(false);
    expect((await requestConnection()).status).toBe(403);
    isOperatorRequest.mockResolvedValue(true);
    expect((await requestConnection("synthetic-key")).status).toBe(400);
    expect(createProviderConnection).not.toHaveBeenCalled();
    expect((await requestConnection()).status).toBe(201);
    expect(createProviderConnection).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ provider: PROVIDER, apiKey: "" }), expect.anything(),
    );
    const validation = await validate(new Request("http://localhost/api/providers/validate", {
      method: "POST", body: JSON.stringify({ provider: PROVIDER }),
    }));
    expect(await validation.json()).toMatchObject({ valid: false, skipped: true });
    expect(canDiscoverModels({ provider: PROVIDER })).toBe(true);
    expect(await fetchConnectionModels({ id: "offline", provider: PROVIDER })).toMatchObject({
      source: "local_catalog",
      models: [{ id: MODEL }, { id: "swe-1-6-fast" }],
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("selects only an eligible saved connection and never falls back to public access", async () => {
    expect(await getProviderCredentials("dva")).toBeNull();
    getProviderConnections.mockResolvedValueOnce([{ id: "offline", provider: PROVIDER, isActive: true }]);
    expect(await getProviderCredentials("dva", null, null, { allowedConnectionIds: ["other"] })).toBeNull();
    getProviderConnections.mockResolvedValueOnce([{ id: "offline", provider: PROVIDER, isActive: true }]);
    expect(await getProviderCredentials("dva", null, null, { allowedConnectionIds: ["offline"] })).toMatchObject({
      id: "offline", authType: "none",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("streams native tool lifecycle and completion through the translated gateway path", async () => {
    const child = fakeClient(({ id, method }) => {
      if (method === "initialize") queueMicrotask(() => openSession(child));
      if (method !== "session/prompt") return;
      queueMicrotask(() => {
        child.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "wrong session" } }, "alien");
        child.send({ id: 25, method: "session/request_permission", params: {
          sessionId: "isolated-session", options: [{ optionId: "allow", kind: "allow_always" }],
        } });
        child.send({ id: 26, method: "fs/write_text_file", params: { path: "/offline/forbidden" } });
        child.update({ sessionUpdate: "tool_call", toolCallId: "tool-1", kind: "read", status: "pending", rawInput: "sensitive input" });
        child.update({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: "sensitive output" });
        child.update({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" });
        child.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello back" } });
        child.send({ id, result: { stopReason: "end_turn" } });
      });
    });
    const request = {
      model: "dva/adaptive", stream: true,
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }],
    };
    const result = await handleChatCore({
      body: request, modelInfo: parseModel(request.model),
      credentials: { apiKey: "synthetic-gateway-secret", providerSpecificData: {} }, connectionId: "offline",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: request, headers: { accept: "text/event-stream" } },
    });
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await result.response.text();
    expect(text).toContain("read — pending");
    expect(text.match(/read — completed/g)).toHaveLength(1);
    expect(text).toContain("Hello back");
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain('"estimated":true');
    expect(text).toContain("[DONE]");
    for (const forbidden of ["wrong session", "sensitive input", "sensitive output", '"tool_calls":']) {
      expect(text).not.toContain(forbidden);
    }
    expect(spawn).toHaveBeenCalledExactlyOnceWith("/offline/devin",
      ["--sandbox", "--permission-mode", "normal", "acp", "--model", MODEL],
      {
        cwd: expect.any(String), stdio: ["pipe", "pipe", "pipe"],
        env: {
          HOME: expect.any(String), PATH: expect.any(String),
          XDG_CONFIG_HOME: expect.stringMatching(/\/\.config$/),
          XDG_DATA_HOME: expect.stringMatching(/\/\.local\/share$/),
          XDG_CACHE_HOME: expect.stringMatching(/\/\.cache$/),
        },
      },
    );
    expect(child.requests()).toMatchObject([
      { method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "durindoor" } } },
      { method: "session/new", params: { mcpServers: [] } },
      { method: "session/prompt", params: { sessionId: "isolated-session", prompt: [{ type: "text", text: "[system]\nBe brief.\n\n[user]\nHello" }] } },
      { id: 25, result: { outcome: { outcome: "cancelled" } } },
      { id: 26, error: { code: -32601 } },
    ]);
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });

  it("converts the ACP completion to a Claude Messages response", async () => {
    const child = fakeClient(({ id, method }) => {
      if (method === "initialize") queueMicrotask(() => openSession(child));
      if (method === "session/prompt") queueMicrotask(() => {
        child.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Claude reply" } });
        child.send({ id, result: { stopReason: "max_tokens" } });
      });
    });
    const request = { ...body, model: "dva/adaptive", max_tokens: 24 };
    const result = await handleChatCore({
      body: request, modelInfo: parseModel(request.model),
      credentials: { providerSpecificData: {} }, connectionId: "offline",
      clientRawRequest: { endpoint: "/v1/messages", body: request, headers: { accept: "application/json" } },
      sourceFormatOverride: "claude",
    });
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toMatchObject({
      type: "message", content: [{ type: "text", text: "Claude reply" }],
      stop_reason: "max_tokens", usage: { output_tokens: 3 },
    });
  });

  it("rejects unknown models, caller tools, and proxy requirements before spawning", async () => {
    const executor = getExecutor(PROVIDER);
    for (const input of [
      { model: "invalid", body },
      { model: MODEL, body: { ...body, tools: [{ name: "execute" }] } },
      { model: MODEL, body, proxyOptions: { strictProxy: true } },
    ]) {
      expect((await executor.execute(input)).response.status).toBe(400);
    }
    vi.stubEnv("DEVIN_AGENTIC_HOME", process.cwd());
    expect((await executor.execute({ model: MODEL, body })).response.status).toBe(503);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("maps a premature close after text to an SSE error and a spawn error to JSON 502", async () => {
    const child = fakeClient();
    const result = await getExecutor(PROVIDER).execute({ model: MODEL, body, stream: true });
    openSession(child);
    child.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "partial" } });
    child.emit("close", 1);
    const text = await result.response.text();
    expect(text).toContain("partial");
    expect(text).toContain("Devin CLI exited before completing the ACP turn");
    expect(text).not.toContain('"finish_reason":"stop"');

    const broken = fakeClient();
    const pending = getExecutor(PROVIDER).execute({ model: MODEL, body, stream: false });
    broken.emit("error", new Error("ENOENT /private/fixture"));
    const { response } = await pending;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { message: "Could not launch Devin CLI", type: "devin_cli_agentic_error" },
    });
  });

  it("cancels a disconnected consumer and isolates a concurrent JSON turn", async () => {
    vi.useFakeTimers();
    const first = fakeClient();
    const second = fakeClient();
    const executor = getExecutor(PROVIDER);
    const result = await executor.execute({ model: MODEL, body, stream: true });
    const pending = executor.execute({ model: MODEL, body, stream: false });
    openSession(first);
    openSession(second);
    await result.response.body.cancel();
    expect(first.requests().at(-1)).toEqual({
      jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "isolated-session" },
    });
    expect(first.stdin.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(first.kill).toHaveBeenCalledWith("SIGKILL");
    first.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "stale" } });
    second.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "other turn" } });
    second.send({ id: 3, result: { stopReason: "end_turn" } });
    const { response } = await pending;
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: "other turn" }, finish_reason: "stop" }],
      usage: { completion_tokens: 3, estimated: true },
    });
    expect(second.requests().some((request) => request.method === "session/cancel")).toBe(false);
  });

  it("cancels on abort and times out a silent client", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const child = fakeClient();
    const pending = getExecutor(PROVIDER).execute({ model: MODEL, body, signal: controller.signal });
    openSession(child);
    controller.abort();
    expect((await pending).response.status).toBe(499);
    expect(child.requests().at(-1).method).toBe("session/cancel");

    fakeClient();
    const silent = getExecutor(PROVIDER).execute({ model: MODEL, body });
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await silent).response.status).toBe(504);
  });
});
