// Issue 2314 item 2: both Gemini thought-signature APIs sit on one store with
// one key scheme (`<scope>:<toolCallId>` plus a bare alias) and one prune cap.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../open-sse/services/thoughtSignatureStore.js";
import * as keyed from "../../open-sse/services/geminiThoughtSignatureStore.js";
import { getAdapter } from "../../src/lib/db/driver.js";

const SCOPE = "gemini_thought_signatures";
const DAY = 24 * 60 * 60 * 1000;
const originalDataDir = process.env.DATA_DIR;
let dataDir;
let db;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "thought-signatures-"));
  process.env.DATA_DIR = dataDir;
  db = await getAdapter();
});

beforeEach(async () => { await keyed.clearGeminiThoughtSignatures(); });

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const forgetMemory = () => keyed.clearGeminiThoughtSignatureMemoryForTests();

function insertLegacy(key, value) {
  db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)", [SCOPE, key, JSON.stringify(value)]);
}

const storedKeys = () => db.all("SELECT key FROM kv WHERE scope = ?", [SCOPE]).map((row) => row.key).sort();

describe("one Gemini thought-signature store behind both APIs", () => {
  it("finds a session-API write through the keyed API, in memory and persisted", async () => {
    session.storeGeminiThoughtSignature("call-a", "sig-a", "sess-1", "gemini-3-pro");
    expect(keyed.getGeminiThoughtSignature("conn-1:call-a")).toBe("sig-a");
    forgetMemory();
    expect(keyed.getGeminiThoughtSignature("conn-1:call-a")).toBe("sig-a");
  });

  it("finds a keyed-API write through the session API, in memory and persisted", async () => {
    keyed.storeGeminiThoughtSignature("conn-1:call-b", "sig-b");
    expect(session.getGeminiThoughtSignatureSync("call-b", "sess-1", "gemini-3-pro")).toBe("sig-b");
    forgetMemory();
    await expect(session.getGeminiThoughtSignature("call-b")).resolves.toBe("sig-b");
  });

  it("keeps keyed writes isolated per connection and model family", () => {
    keyed.storeGeminiThoughtSignature("conn-a:call-iso", "sig-iso");
    session.storeGeminiThoughtSignature("call-claude", "sig-claude", "sess-1", "claude-opus-4-6");
    for (const reload of [false, true]) {
      if (reload) forgetMemory();
      expect(keyed.getGeminiThoughtSignature("conn-b:call-iso")).toBeNull();
      expect(keyed.getGeminiThoughtSignature("conn-a:call-claude")).toBeNull();
    }
    expect(session.getGeminiThoughtSignatureSync("call-iso", null, "claude-opus-4-6")).toBeNull();
  });

  it("applies one prune cap across both APIs, counting each signature once", async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, "now");
    const writes = [
      () => session.storeGeminiThoughtSignature("p1", "s1", "sess"),
      () => keyed.storeGeminiThoughtSignature("conn:p2", "s2"),
      () => session.storeGeminiThoughtSignature("p3", "s3", "sess"),
      () => keyed.storeGeminiThoughtSignature("conn:p4", "s4"),
    ];
    writes.forEach((write, i) => {
      clock.mockReturnValue(start + i);
      write();
    });
    clock.mockRestore();
    await new Promise((resolve) => setTimeout(resolve, 0));

    keyed._pruneForTests(3);

    expect(storedKeys()).toEqual(["conn:p2", "conn:p4", "p2", "p3", "p4", "sess:p3"]);
  });

  it("resolves legacy session-scheme and bare rows through both APIs", async () => {
    const legacy = { signature: "old-session", family: "gemini", createdAt: Date.now(), expiresAt: Date.now() + DAY };
    insertLegacy("sess:old-a", legacy);
    insertLegacy("old-a", legacy);
    await expect(session.getGeminiThoughtSignature("old-a", "sess")).resolves.toBe("old-session");
    forgetMemory();
    expect(keyed.getGeminiThoughtSignature("conn:old-a")).toBe("old-session");
  });

  it("resolves a legacy connection-scheme row and migrates it on read", async () => {
    const expiresAt = Date.now() + 20 * DAY;
    insertLegacy("conn:old-b", { signature: "old-keyed", expiresAt });
    expect(keyed.getGeminiThoughtSignature("conn:old-b")).toBe("old-keyed");
    forgetMemory();
    await expect(session.getGeminiThoughtSignature("old-b", "sess")).resolves.toBe("old-keyed");
    expect(keyed.getGeminiThoughtSignature("other:old-b")).toBeNull();
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [SCOPE, "conn:old-b"]);
    expect(JSON.parse(row.value)).toMatchObject({ signature: "old-keyed", family: "gemini", expiresAt });
    expect(JSON.parse(row.value).createdAt).toBeLessThan(Date.now());
  });
});
