import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_ERROR_MESSAGE_MAX_CHARS } from "../../open-sse/config/runtimeConfig.js";

const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-port-3219-"));
// A catalog id, so the failure locks this model and records its own message.
const MODEL = "gpt-6.2-sol";
const DECISIVE = "Upstream request failed: connection reset by peer";
const LONG_REASON = `Error from provider (Console Go): ${"the gateway could not complete this call. ".repeat(6)}${DECISIVE}`;

let db;
let auth;

beforeAll(async () => {
  process.env.DATA_DIR = tempDir;
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  auth = await import("../../src/sse/services/auth.js");
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function failAccount(provider, errorText, model = null) {
  const connection = await db.createProviderConnection({
    provider, authType: "apikey", apiKey: `key-${provider}`, name: provider,
  });
  await auth.markAccountUnavailable(connection.id, 402, errorText, provider, model);
  return db.getProviderConnectionById(connection.id);
}

describe("port(upstream) #3219 - keep the whole upstream error reason", () => {
  it("persists a reason whose cause sits past 100 characters and replays it to the next client", async () => {
    const stored = await failAccount("openai", LONG_REASON, MODEL);

    expect(stored.lastError).toBe(LONG_REASON);
    expect(stored[`modelUpstream_${MODEL}`].message).toBe(LONG_REASON);

    const blocked = await auth.getProviderCredentials("openai", null, MODEL);
    expect(blocked).toMatchObject({ allRateLimited: true, lastErrorCode: 402, lastError: LONG_REASON });
  });

  it("still bounds a very long reason", async () => {
    const stored = await failAccount("deepseek", "word ".repeat(2000));

    expect(ACCOUNT_ERROR_MESSAGE_MAX_CHARS).toBe(2000);
    expect(stored.lastError.length).toBeGreaterThan(100);
    expect(stored.lastError.length).toBeLessThanOrEqual(ACCOUNT_ERROR_MESSAGE_MAX_CHARS);
    expect(stored.lastError.startsWith("word word")).toBe(true);
  });

  it("redacts a credential that sits past the old cut", async () => {
    const stored = await failAccount("mistral", `${LONG_REASON} Bearer sk-synthetic-past-the-old-cut`);

    expect(stored.lastError).toContain(DECISIVE);
    expect(stored.lastError).toContain("Bearer [redacted]");
    expect(stored.lastError).not.toContain("synthetic-past-the-old-cut");
  });
});
