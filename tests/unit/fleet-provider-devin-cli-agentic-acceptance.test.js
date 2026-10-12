/**
 * #1174 offline scope: installed devin-cli is the native ACP summarizer, not
 * devin-cli-agentic/dva. Upstream registry metadata declares a distinct Claude
 * agentic executor with CLI-owned auth; metadata does not prove runtime support.
 * Mocked child processes and fetch prove local wiring only, never account/model
 * availability. No g4f, web, or app-server transport qualifies as native Devin.
 * Live verification is unavailable; agentic tools/vision/reasoning remain unproven.
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});

function offlineFetch() {
  const fetcher = vi.fn(async () => new Response('{"error":"offline unauthorized fixture"}', {
    status: 401, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetcher);
  restoreFetch = __setOriginalFetchForTesting(fetcher);
  return fetcher;
}

describe("#1174 Devin CLI agentic acceptance boundary (offline partial)", () => {
  it("does not validate the unsupported candidate or discover a fabricated account catalog", async () => {
    const fetcher = offlineFetch();
    expect(hasSpecializedExecutor("devin-cli")).toBe(true);
    for (const provider of ["devin-cli-agentic", "dva"]) {
      expect(PROVIDERS[provider]).toBeUndefined();
      expect(hasSpecializedExecutor(provider)).toBe(false);
      expect(await probeRegistryProvider(provider, "fixture-only-token", fetcher)).toBeNull();
      expect(await fetchConnectionModels({ id: "offline", provider, apiKey: "fixture-only-token" }))
        .toEqual({ error: `Provider ${provider} does not support models listing`, status: 400 });
    }
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
      sessionId: "offline-session", content: [{ type: "text", text: "[System]\nBe brief.\n\n[User]\nHello" }],
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

  it("rejects unsupported agentic identity rather than dispatching credentials to OpenAI (security regression)", async () => {
    const fetcher = offlineFetch();
    let rejected = false;
    try {
      const result = await getExecutor("devin-cli-agentic").execute({
        model: "fixture-model", body: { messages: [{ role: "user", content: "Hello" }] },
        stream: false, credentials: { apiKey: "fixture-only-candidate-token" },
      });
      await result.response.text();
    } catch {
      rejected = true;
    }
    expect(fetcher, "Unsupported Devin candidate must not dispatch to any HTTP provider").not.toHaveBeenCalled();
    expect(rejected, "Unsupported native transport needs an explicit rejection").toBe(true);
  });
});
