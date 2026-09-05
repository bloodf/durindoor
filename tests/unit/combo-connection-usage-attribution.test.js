import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;
let handleChatCore;
let comboUsageGET;
let restoreFetch;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-combo-usage-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await import("@/lib/db/driver.js").then((module) => module.getAdapter());

  // Run real ollama-local executor; intercept only transport with Ollama's
  // native /api/chat response contract for each negotiated stream mode.
  const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
  restoreFetch = __setOriginalFetchForTesting(async (_url, init) => {
    const request = JSON.parse(init.body);
    const terminal = {
      model: "llama3.2:1b",
      created_at: "2026-09-04T00:00:00.000Z",
      message: { role: "assistant", content: request.stream ? "" : "hello attribution" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 7,
      eval_count: 4,
    };
    if (request.stream) {
      const body = [
        JSON.stringify({ model: terminal.model, message: { role: "assistant", content: "hello attribution" }, done: false }),
        JSON.stringify(terminal),
      ].join("\n") + "\n";
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    }
    return new Response(JSON.stringify(terminal), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  ({ GET: comboUsageGET } = await import("@/app/api/usage/combos/route.js"));
  ({ handleChatCore } = await import("../../open-sse/handlers/chatCore.js"));
});

afterAll(() => {
  restoreFetch?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function runWithCombo({ comboId, comboName, connectionId, stream = false }) {
  const result = await handleChatCore({
    body: {
      model: "ollama-local/llama3.2:1b",
      stream,
      messages: [{ role: "user", content: "ping" }],
    },
    modelInfo: { provider: "ollama-local", model: "llama3.2:1b" },
    credentials: { providerSpecificData: {} },
    log: {
      tagForSession: () => "t",
      nextTag: () => "t",
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      line: () => {},
      errorLine: () => {},
    },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      headers: { accept: stream ? "text/event-stream" : "application/json" },
      body: {},
    },
    connectionId,
    comboId,
    comboName,
  });
  expect(result.success, result.error).toBe(true);
  await result.response.text();
  await vi.waitFor(() => {
    expect(adapter.get(
      `SELECT COUNT(*) AS requests FROM usageHistory WHERE connectionId = ?`,
      [connectionId],
    )).toEqual({ requests: 1 });
  });
}

describe("combo attribution flows through real chatCore handlers", () => {
  it("reports only future recorded combo identity and keeps old or direct requests unattributed", async () => {
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, promptTokens, completionTokens, cost, status, tokens)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["2026-09-01T00:00:00.000Z", "ollama-local", "llama3.2:1b", "old-connection", 4, 2, 0, "ok", "{}"],
    );

    await runWithCombo({ comboId: "combo-1", comboName: "Production", connectionId: "connection-a" });
    await runWithCombo({ comboId: "combo-1", comboName: "Production", connectionId: "connection-b", stream: true });
    await runWithCombo({ comboId: null, comboName: null, connectionId: "connection-direct" });

    const rows = adapter.all(`SELECT connectionId, comboId, comboName FROM usageHistory ORDER BY id`);
    expect(rows).toEqual([
      { connectionId: "old-connection", comboId: null, comboName: null },
      { connectionId: "connection-a", comboId: "combo-1", comboName: "Production" },
      { connectionId: "connection-b", comboId: "combo-1", comboName: "Production" },
      { connectionId: "connection-direct", comboId: null, comboName: null },
    ]);

    expect((await comboUsageGET(new Request("http://localhost/api/usage/combos?period=bogus"))).status).toBe(400);
    expect((await comboUsageGET(new Request("http://localhost/api/usage/combos?period=all&startDate=2026-09-01"))).status).toBe(400);
    expect((await comboUsageGET(new Request("http://localhost/api/usage/combos?period=all&startDate=2026-02-30&endDate=2026-09-04"))).status).toBe(400);

    const response = await comboUsageGET(new Request("http://localhost/api/usage/combos?period=all"));
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.rows).toEqual([
      { comboId: "combo-1", comboName: "Production", connectionId: "connection-a", requests: 1, promptTokens: 7, completionTokens: 4, cost: 0 },
      { comboId: "combo-1", comboName: "Production", connectionId: "connection-b", requests: 1, promptTokens: 7, completionTokens: 4, cost: 0 },
    ]);
    expect(report.rows.some((row) => row.connectionId === "old-connection")).toBe(false);
    expect(report.unattributed).toEqual({ requests: 2, promptTokens: 11, completionTokens: 6, cost: 0 });
  });
});
