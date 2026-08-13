import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-active-sessions-"));
process.env.DATA_DIR = dataDir;
const { finishActiveSession, getActiveRequests, saveRequestUsage, trackPendingRequest } = await import("../../src/lib/db/repos/usageRepo.js");
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("live usage sessions (#3273)", () => {
  beforeEach(() => {
    global._activeSessions.clear();
    global._pendingRequests.byModel = {};
    global._pendingRequests.byAccount = {};
    for (const key of Object.keys(global._pendingTimers)) {
      clearTimeout(global._pendingTimers[key]);
      delete global._pendingTimers[key];
    }
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
});
