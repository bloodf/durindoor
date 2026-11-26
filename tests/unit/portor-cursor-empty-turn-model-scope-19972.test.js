import "../translator/registerAll.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A private data dir must exist before any repository module is loaded.
const { dataDir, previousDataDir } = await vi.hoisted(async () => {
  const [{ mkdtempSync }, { tmpdir }, { join }] = await Promise.all([import("node:fs"), import("node:os"), import("node:path")]);
  const previous = process.env.DATA_DIR;
  const dir = mkdtempSync(join(tmpdir(), "cursor-empty-turn-"));
  process.env.DATA_DIR = dir;
  return { dataDir: dir, previousDataDir: previous };
});

const { CursorExecutor } = await import("../../open-sse/executors/cursor.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
const { createProviderConnection, getProviderConnectionById } = await import("../../src/lib/localDb.js");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const { emptyStreamBench } = await import("../../src/sse/handlers/chat/singleModel/dispatch.js");

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const credentials = { accessToken: "test-token", providerSpecificData: { machineId: "a".repeat(64) } };

/** A real CursorExecutor whose AgentService session closes with no output. */
function emptyTurnExecutor() {
  const executor = new CursorExecutor();
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write() {}, end() {}, close() {},
    async read() { return { value: undefined, done: true }; },
  });
  return executor;
}

async function emptyTurn() {
  const { response } = await emptyTurnExecutor().executeAgent({
    model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials,
  });
  return { status: response.status, ...(await response.json()).error };
}

let connectionId;
beforeAll(async () => {
  const connection = await createProviderConnection({ provider: "cursor", authType: "oauth", name: "empty-turn", accessToken: "t", isActive: true });
  connectionId = connection.id;
});

const locks = async () => Object.entries(await getProviderConnectionById(connectionId))
  .filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);

describe("OmniRoute #19972 - a bare Cursor empty turn is scoped to the model", () => {
  it("leaves other providers' empty streams on the generic bench", () => {
    expect(emptyStreamBench("openai", "m", { message: "boom" })).toMatchObject({ status: 502, reason: "Empty streaming response from openai/m" });
    expect(emptyStreamBench("cursor", "m", undefined).status).toBe(502);
  });

  it("answers 404 and fails over with a model-only denial", async () => {
    const error = await emptyTurn();
    expect(error.status).toBe(404);
    expect(error.message).toMatch(/not available on this account.*empty turn/);

    expect(checkFallbackError({ status: 404, errorText: error.message, provider: "cursor", model: "gpt-5.2" }))
      .toMatchObject({ shouldFallback: true, modelOnly: true, scope: "model" });
  });

  it("never widens an uncatalogued model to an account lock", async () => {
    const { message } = await emptyTurn();
    const outcome = await markAccountUnavailable(connectionId, 404, message, "cursor", "live-only-model-x");
    expect(outcome.shouldFallback).toBe(true);
    expect(await locks()).toEqual([]);
  });

  it("locks only the refused catalog model", async () => {
    const { message } = await emptyTurn();
    await markAccountUnavailable(connectionId, 404, message, "cursor", "claude-4.5-opus-high");
    expect(await locks()).toEqual(["modelLock_claude-4.5-opus-high"]);
  });

  it("keeps the same scope when the empty turn arrives after stream headers", async () => {
    const connection = await createProviderConnection({ provider: "cursor", authType: "oauth", name: "empty-turn-stream", accessToken: "s", isActive: true });
    connectionId = connection.id;
    const onEmptyStream = vi.fn();
    const body = { model: "live-only-model-x", stream: true, messages: [{ role: "user", content: "hi" }] };
    const result = await handleChatCore({
      body, modelInfo: { provider: "cursor", model: "live-only-model-x" }, credentials: { ...credentials },
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
      executorOverride: emptyTurnExecutor(), onEmptyStream,
    });
    await result.response.text();
    await vi.waitFor(() => expect(onEmptyStream).toHaveBeenCalledOnce());
    const [streamError] = onEmptyStream.mock.calls[0];
    expect(streamError.message).toMatch(/not available on this account/);

    const bench = emptyStreamBench("cursor", "live-only-model-x", streamError);
    expect(bench).toMatchObject({ status: 404, resetsAtMs: null });
    await markAccountUnavailable(connectionId, bench.status, bench.reason, "cursor", "live-only-model-x", bench.resetsAtMs);
    expect(await locks()).toEqual([]);
  });
});
