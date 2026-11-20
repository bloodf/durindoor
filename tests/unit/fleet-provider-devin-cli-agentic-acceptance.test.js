import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted before executor/registry imports: no release refresh or background timer.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/0.1.01",
  updateKimchiUserAgent: vi.fn(async () => "kimchi/0.1.01"),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

function acpChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { destroyed: false, write: vi.fn(), end: vi.fn() };
  child.killed = false;
  child.kill = vi.fn();
  spawn.mockReturnValue(child);
  return child;
}

function receive(child, message) {
  child.stdout.emit("data", Buffer.from(`${JSON.stringify(message)}\n`));
}

function sent(child) {
  return child.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
}

function frames(text) {
  return text.split("\n\n").filter(Boolean).map((frame) => {
    const data = frame.slice("data: ".length);
    return data === "[DONE]" ? data : JSON.parse(data);
  });
}

let restoreFetch;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function offlineFetch() {
  const fetcher = vi.fn(async () => new Response('{"error":"offline unauthorized fixture"}', {
    status: 401, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetcher);
  restoreFetch = __setOriginalFetchForTesting(fetcher);
  return fetcher;
}

describe("#1174 existing Devin routes (offline)", () => {
  it("keeps the native summarizer separate from the new agentic identity", async () => {
    const fetcher = offlineFetch();
    expect(hasSpecializedExecutor("devin-cli")).toBe(true);
    expect(PROVIDERS["devin-cli-agentic"]).toMatchObject({ format: "claude" });
    expect(getExecutor("dva")).toBe(getExecutor("devin-cli-agentic"));
    expect(getExecutor("dva")).not.toBe(getExecutor("devin-cli"));
    expect(await probeRegistryProvider("devin-cli", "fixture-only-token", fetcher)).toMatchObject({ blocked: true, valid: false });
    expect(await fetchConnectionModels({ id: "offline", provider: "devin-cli", apiKey: "fixture-only-token" }))
      .toEqual({ error: "Provider devin-cli does not support models listing", status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("executes installed native ACP request/auth/stream without pretending to return agentic tool calls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("CLI_DEVIN_BIN", "/offline/devin");
    const fetcher = offlineFetch();
    const child = acpChild();
    const executor = getExecutor("devin-cli");
    const result = await executor.execute({
      model: "fixture-model-not-account-proof",
      credentials: { apiKey: "fixture-only-token" },
      body: {
        messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hello" }],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        tool_choice: "required",
      },
    });
    expect(spawn).toHaveBeenCalledWith("/offline/devin", ["acp", "--agent-type", "summarizer"], expect.objectContaining({
      env: expect.objectContaining({ WINDSURF_API_KEY: "fixture-only-token" }),
      stdio: ["pipe", "pipe", "pipe"],
    }));
    expect(sent(child)[0]).toMatchObject({ method: "initialize", params: { protocolVersion: "0.3" } });
    receive(child, { id: 1, result: {} });
    expect(sent(child)[1]).toMatchObject({ method: "session/new", params: { model: "fixture-model-not-account-proof" } });
    receive(child, { id: 2, result: { sessionId: "offline-session" } });
    expect(sent(child)[2]).toMatchObject({ method: "session/prompt", params: {
      sessionId: "offline-session", prompt: [{ type: "text", text: "[System]\nBe brief.\n\n[User]\nHello" }],
    } });
    expect(sent(child)[2].params).not.toHaveProperty("tools");
    expect(sent(child)[2].params).not.toHaveProperty("tool_choice");
    receive(child, { method: "session/update", params: { type: "text_delta", text: "Hel" } });
    receive(child, { method: "session/update", params: { type: "text_delta", text: "lo" } });
    receive(child, { method: "session/update", params: { type: "done" } });
    const chunks = frames(await result.response.text());
    expect(result.url).toBe("devin://acp/stdio");
    expect(result.headers).toEqual({});
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks.slice(1, 3).map((chunk) => chunk.choices[0].delta.content).join("")).toBe("Hello");
    expect(chunks.at(-2)).toMatchObject({ choices: [{ finish_reason: "stop" }], usage: { estimated: true } });
    expect(chunks.at(-1)).toBe("[DONE]");
    expect(chunks.slice(0, -1).every((chunk) => !chunk.choices[0].delta.tool_calls)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces native ACP errors instead of a successful completion", async () => {
    vi.useFakeTimers();
    const fetcher = offlineFetch();
    const child = acpChild();
    const result = await getExecutor("devin-cli").execute({ model: "fixture-model", body: { messages: [] } });
    receive(child, { id: 1, error: { code: -32000, message: "offline auth rejected" } });
    expect(frames(await result.response.text())).toEqual([
      { error: { message: "Devin ACP error -32000: offline auth rejected", type: "devin_cli_error" } },
      "[DONE]",
    ]);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

});
