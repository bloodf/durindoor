import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THINKING_AG_SIGNATURE,
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
} from "../../open-sse/config/defaultThinkingSignature.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: send,
}));

describe("9router #5894 Antigravity persisted Gemini tool signatures", () => {
  let tmpDir;
  let AntigravityExecutor;
  let storeGeminiThoughtSignature;
  let clearThoughtSignatureMemory;
  let clearThoughtSignatures;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-persisted-sig-5894-"));
    vi.stubEnv("DATA_DIR", tmpDir);
    vi.resetModules();
    send.mockReset();
    send.mockResolvedValue(new Response(JSON.stringify({ response: { candidates: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", send);
    ({ AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js"));
    ({
      storeGeminiThoughtSignature,
      clearThoughtSignatureMemory,
      clearThoughtSignatures,
    } = await import("../../open-sse/services/thoughtSignatureStore.js"));
    await clearThoughtSignatures();
  });

  afterEach(async () => {
    await clearThoughtSignatures?.();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("restores persisted Gemini tool-call signatures from SQLite on cold RAM cache", async () => {
    storeGeminiThoughtSignature("call_persist_1", "real-gemini-sig-from-sqlite", "sess-5894", "gemini-3-flash");
    clearThoughtSignatureMemory();

    const executor = new AntigravityExecutor();
    await executor.execute({
      model: "gemini-3-flash",
      stream: false,
      credentials: { accessToken: "tok", projectId: "proj-1", _clientSessionId: "sess-5894" },
      body: {
        model: "gemini-3-flash",
        request: {
          contents: [
            { role: "user", parts: [{ text: "run tool" }] },
            { role: "model", parts: [{ functionCall: { id: "call_persist_1", name: "lookup", args: {} } }] },
            { role: "user", parts: [{ functionResponse: { id: "call_persist_1", name: "lookup", response: { ok: true } } }] },
          ],
        },
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(send.mock.calls[0][1].body);
    const fnPart = sent.request.contents[1].parts.find((part) => part.functionCall);
    expect(fnPart.thoughtSignature).toBe("real-gemini-sig-from-sqlite");
  });

  it("replaces default placeholder signatures with persisted values while keeping explicit signatures", async () => {
    storeGeminiThoughtSignature("call_placeholder", "persisted-real-sig", "sess-5894", "gemini-3-pro");
    storeGeminiThoughtSignature("call_explicit", "persisted-unused-sig", "sess-5894", "gemini-3-pro");
    clearThoughtSignatureMemory();

    const executor = new AntigravityExecutor();
    await executor.execute({
      model: "gemini-3-pro",
      stream: false,
      credentials: { accessToken: "tok", projectId: "proj-1", _clientSessionId: "sess-5894" },
      body: {
        model: "gemini-3-pro",
        request: {
          contents: [
            { role: "user", parts: [{ text: "run tools" }] },
            {
              role: "model",
              parts: [
                { functionCall: { id: "call_placeholder", name: "a", args: {} }, thoughtSignature: DEFAULT_THINKING_GEMINI_CLI_SIGNATURE },
                { functionCall: { id: "call_explicit", name: "b", args: {} }, thoughtSignature: "caller-explicit-sig" },
              ],
            },
            {
              role: "user",
              parts: [
                { functionResponse: { id: "call_placeholder", name: "a", response: { ok: true } } },
                { functionResponse: { id: "call_explicit", name: "b", response: { ok: true } } },
              ],
            },
          ],
        },
      },
    });

    const sent = JSON.parse(send.mock.calls[0][1].body);
    const parts = sent.request.contents[1].parts;
    expect(parts[0].thoughtSignature).toBe("persisted-real-sig");
    expect(parts[1].thoughtSignature).toBe("caller-explicit-sig");
  });

  it("keeps model-family isolation when restoring persisted signatures", async () => {
    storeGeminiThoughtSignature("call_claude_sig", "claude-only-sig", "sess-5894", "claude-sonnet-4-6");
    clearThoughtSignatureMemory();

    const executor = new AntigravityExecutor();
    await executor.execute({
      model: "gemini-3-flash",
      stream: false,
      credentials: { accessToken: "tok", projectId: "proj-1", _clientSessionId: "sess-5894" },
      body: {
        model: "gemini-3-flash",
        request: {
          contents: [
            { role: "user", parts: [{ text: "run tool" }] },
            { role: "model", parts: [{ functionCall: { id: "call_claude_sig", name: "lookup", args: {} }, thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE }] },
            { role: "user", parts: [{ functionResponse: { id: "call_claude_sig", name: "lookup", response: { ok: true } } }] },
          ],
        },
      },
    });

    const sent = JSON.parse(send.mock.calls[0][1].body);
    const fnPart = sent.request.contents[1].parts.find((part) => part.functionCall);
    expect(fnPart.thoughtSignature).not.toBe("claude-only-sig");
  });
});
