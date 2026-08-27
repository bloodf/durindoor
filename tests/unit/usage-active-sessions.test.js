import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-active-sessions-"));
process.env.DATA_DIR = dataDir;
const { finishActiveSession, getActiveRequests, saveRequestUsage, trackPendingRequest } = await import("../../src/lib/db/repos/usageRepo.js");
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());


describe("live usage sessions (#3273)", () => {
  beforeEach(() => {
    global._activeSessions.clear();
    global._pendingRequests.byKey = {};
    global._pendingRequests.byModel = {};
    global._pendingRequests.byAccount = {};
    for (const key of Object.keys(global._pendingTimers)) {
      clearTimeout(global._pendingTimers[key]);
      delete global._pendingTimers[key];
    }
    global._pendingCalls.clear();
    global._connectionMapCache.map = { "conn-1": "Primary account" };
    global._connectionMapCache.ts = Date.now();
  });

  it("finishes success, error, and disconnect rows by request id", async () => {
    const successId = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, {
      requestId: "success",
      clientId: "127.0.0.1",
      sessionId: "session-success",
    });
    expect(successId).toBe("success");
    await saveRequestUsage({
      usageEventId: successId,
      provider: "codex",
      model: "gpt-5.6",
      connectionId: "conn-1",
      tokens: { prompt_tokens: 11, completion_tokens: 7 },
    });

    const errorId = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "error" });
    trackPendingRequest("gpt-5.6", "codex", "conn-1", false, true);
    finishActiveSession({ requestId: errorId, status: "error" });
    const disconnectId = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "disconnect" });
    trackPendingRequest("gpt-5.6", "codex", "conn-1", false, true);
    finishActiveSession({ requestId: disconnectId, status: "error" });

    const { activeSessions } = await getActiveRequests();
    expect(activeSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: "success", status: "done", promptTokens: 11, completionTokens: 7 }),
      expect.objectContaining({ requestId: "error", status: "error" }),
      expect.objectContaining({ requestId: "disconnect", status: "error" }),
    ]));
    expect(activeSessions.filter((session) => session.status === "active")).toHaveLength(0);
  });

  it("keeps an interrupted session errored after partial usage persists", async () => {
    const requestId = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "interrupted" });
    finishActiveSession({ requestId, status: "error" });

    await saveRequestUsage({
      usageEventId: requestId,
      provider: "codex",
      model: "gpt-5.6",
      connectionId: "conn-1",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
      status: "cancelled",
    });

    const { activeSessions } = await getActiveRequests();
    expect(activeSessions.find((session) => session.requestId === requestId)).toMatchObject({
      status: "error",
    });
  });

  it("does not cross-associate concurrent requests for the same route", async () => {
    const first = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "first" });
    const second = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "second" });
    await saveRequestUsage({ usageEventId: second, provider: "codex", model: "gpt-5.6", connectionId: "conn-1", tokens: { prompt_tokens: 2, completion_tokens: 3 } });

    const { activeSessions } = await getActiveRequests();
    expect(activeSessions.find((session) => session.requestId === first)).toMatchObject({ status: "active", promptTokens: null });
    expect(activeSessions.find((session) => session.requestId === second)).toMatchObject({ status: "done", promptTokens: 2, completionTokens: 3 });
  });

  it("does not decrement a concurrent pending request when an early-released session later succeeds", () => {
    const first = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "early-first" });
    trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, { requestId: "still-running" });

    trackPendingRequest("gpt-5.6", "codex", "conn-1", false);
    expect(global._pendingRequests.byModel["gpt-5.6 (codex)"]).toBe(1);
    finishActiveSession({ requestId: first, status: "done" });

    expect(global._pendingRequests.byModel["gpt-5.6 (codex)"]).toBe(1);
  });

  it("keeps the remaining key active when another key finishes the same model", async () => {
    trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, null, "OMP Production");
    trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, null, "Cursor Dev");

    trackPendingRequest("gpt-5.6", "codex", "conn-1", false, false, null, "OMP Production");

    const { activeRequests } = await getActiveRequests();
    expect(activeRequests).toEqual([
      expect.objectContaining({
        model: "gpt-5.6",
        provider: "codex",
        count: 1,
        keys: [{ name: "Cursor Dev", count: 1 }],
      }),
    ]);
    expect(JSON.stringify(activeRequests)).not.toContain("sk-");
    expect(JSON.stringify(activeRequests)).not.toContain("keyId");
  });

  it("keeps a timeout for the second concurrent call from the same key", async () => {
    vi.useFakeTimers();
    trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, null, "OMP Production");
    trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, null, "OMP Production");

    trackPendingRequest("gpt-5.6", "codex", "conn-1", false, false, null, "OMP Production");
    expect((await getActiveRequests()).activeRequests[0]).toMatchObject({
      count: 1,
      keys: [{ name: "OMP Production", count: 1 }],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await getActiveRequests()).activeRequests).toEqual([]);
  });

  it("ignores a duplicate completion token", async () => {
    const requestId = trackPendingRequest("gpt-5.6", "codex", "conn-1", true, false, null, "OMP Production");
    trackPendingRequest("gpt-5.6", "codex", "conn-1", false, false, { requestId }, "OMP Production");
    trackPendingRequest("gpt-5.6", "codex", "conn-1", false, false, { requestId }, "OMP Production");
    expect((await getActiveRequests()).activeRequests).toEqual([]);
    expect(global._pendingRequests.byModel["gpt-5.6 (codex)"]).toBeUndefined();
  });
});
