// OmniRoute #20266: a Codex ChatGPT-account model refusal describes one account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-codex-20266-"));
const CATALOG = "gpt-5.6-sol";
// Neither id is in the Codex catalog, so neither has a bounded lock scope.
const UNLISTED = ["gpt-9-unlisted", "gpt-5.6-sol-high"];
const refusal = (model) => `[400]: {"detail":"The '${model}' model is not supported when using Codex with a ChatGPT account."}`;

let db;
let auth;
let first;
let second;

beforeAll(async () => {
  process.env.DATA_DIR = tempDir;
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  auth = await import("../../src/sse/services/auth.js");
});

beforeEach(async () => {
  for (const connection of await db.getProviderConnections({ provider: "codex" })) {
    await db.deleteProviderConnection(connection.id);
  }
  const create = (name, priority) => db.createProviderConnection({ provider: "codex", authType: "apikey", apiKey: `synthetic-${name}`, name, priority });
  first = await create("first", 1);
  second = await create("second", 2);
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const locksOf = async (id) => {
  const stored = await db.getProviderConnectionById(id);
  return Object.keys(stored).filter((key) => key.startsWith("modelLock_") && stored[key]);
};

describe("port(omniroute): #20266 Codex account-scoped model refusals rotate accounts", () => {
  it("locks only the refused catalog model and serves it from the second account", async () => {
    const result = await auth.markAccountUnavailable(first.id, 400, refusal(CATALOG), "codex", CATALOG);

    expect(result.shouldFallback).toBe(true);
    expect(await locksOf(first.id)).toEqual([`modelLock_${CATALOG}`]);
    expect((await auth.getProviderCredentials("codex", null, CATALOG)).connectionId).toBe(second.id);
    expect((await auth.getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe(first.id);
  });

  it.each(UNLISTED)("rotates for %s without cooling any model on the account", async (model) => {
    const result = await auth.markAccountUnavailable(first.id, 400, refusal(model), "codex", model);

    expect(result.shouldFallback).toBe(true);
    expect(await locksOf(first.id)).toEqual([]);
    expect((await auth.getProviderCredentials("codex", new Set([first.id]), model)).connectionId).toBe(second.id);
    expect((await auth.getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe(first.id);
  });

  it.each([CATALOG, ...UNLISTED])("keeps a generic wrong-model error terminal for %s", async (model) => {
    const result = await auth.markAccountUnavailable(first.id, 400, "[400]: The requested model is not supported.", "codex", model);

    expect(result.shouldFallback).toBe(false);
    expect(await locksOf(first.id)).toEqual([]);
  });

  it("does not widen the exemption to another provider", () => {
    expect(checkFallbackError({ status: 400, errorText: refusal(UNLISTED[0]), provider: "openai", model: UNLISTED[0] }))
      .toMatchObject({ shouldFallback: false, requestScoped: true });
  });
});
