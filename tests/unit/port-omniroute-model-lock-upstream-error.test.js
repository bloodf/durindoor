import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const PROVIDER = "grok-cli";
const BILLED = "grok-4.6";
const OTHER = "grok-4.5";
const CREDIT = "Your credit balance is too low to access this API.";

let tempDir;
let originalDataDir;
let originalHome;
let localDb;
let auth;

// One cold load of the auth graph can outlast a single test's time limit, so it
// happens once here with its own budget.
beforeAll(async () => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-model-lock-error-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  localDb = await import("@/lib/localDb");
  auth = await import("../../src/sse/services/auth.js");
}, 120_000);

beforeEach(async () => {
  for (const { id } of await localDb.getProviderConnections({ provider: PROVIDER })) {
    await localDb.deleteProviderConnection(id);
  }
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function setup() {
  const { id } = await localDb.createProviderConnection({
    provider: PROVIDER, authType: "apikey", name: "billing", apiKey: "test-key", isActive: true, testStatus: "active",
  });
  let stamp = Date.now() - 1000;
  const fail = (status, message, model) => auth.markAccountUnavailable(id, status, message, PROVIDER, model, null, {
    attemptStartedAt: ++stamp,
  });
  const select = (model) => auth.getProviderCredentials(PROVIDER, null, model);
  return { fail, select };
}

describe("OmniRoute #20980 (9ac2e52d18b0) model-only cooldown keeps its billing upstream error", () => {
  it.each([400, 402])("answers with the upstream %i status and message", async (status) => {
    const { fail, select } = await setup();
    // A 400 needs terminal billing evidence to lock at all; the same body serves both statuses.
    await fail(status, CREDIT, BILLED);
    expect(await select(BILLED)).toMatchObject({ allRateLimited: true, lastErrorCode: status, lastError: CREDIT });
  });

  it("is not overwritten by a later failure of another model on the connection", async () => {
    const { fail, select } = await setup();
    await fail(402, CREDIT, BILLED);
    await fail(429, "slow down", OTHER);
    expect(await select(BILLED)).toMatchObject({ lastErrorCode: 402, lastError: CREDIT });
    expect(await select(OTHER)).toMatchObject({ lastErrorCode: 429, lastError: "Rate limited" });
  });

  it("does not lend its billing error to another model's lock", async () => {
    const { fail, select } = await setup();
    await fail(429, "slow down", OTHER);
    await fail(402, CREDIT, BILLED);
    expect(await select(OTHER)).toMatchObject({ lastErrorCode: 429, lastError: "Rate limited" });
  });

  it("drops the billing error once a newer non-billing failure relocks the model", async () => {
    const { fail, select } = await setup();
    await fail(402, CREDIT, BILLED);
    await fail(429, "slow down", BILLED);
    expect(await select(BILLED)).toMatchObject({ lastErrorCode: 429, lastError: "Rate limited" });
  });
});
