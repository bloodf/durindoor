// OmniRoute #20343: Workers AI 403 code 5035 gates one model, not the connection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-cf-5035-"));
const CATALOG_PAID = "@cf/zai-org/glm-5.3";
const UNLISTED_PAID = "@cf/example/unlisted-paid-model";
const FREE = "@cf/openai/gpt-oss-120b";
const paidBody = (model) => JSON.stringify({
  errors: [{ message: `AiError: Model ${model} is not available on the Workers Free plan. Upgrade to access this model.`, code: 5035 }],
  success: false,
});
const AUTH_BODY = JSON.stringify({ errors: [{ code: 10000, message: "Authentication error" }], success: false });

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

async function fail(model, body) {
  const { id } = await db.createProviderConnection({
    provider: "cloudflare-ai", authType: "apikey", apiKey: `synthetic-${model}-${body.length}`, name: `cf-${model}-${body.length}`,
  });
  const result = await auth.markAccountUnavailable(id, 403, body, "cloudflare-ai", model);
  const stored = await db.getProviderConnectionById(id);
  const locks = Object.keys(stored).filter((key) => key.startsWith("modelLock_") && stored[key]);
  return { result, locks, stored };
}

describe("port(omniroute): #20343 Cloudflare paid-plan 403 locks only the model", () => {
  it("locks a catalog paid model and leaves free models routable", async () => {
    const { result, locks } = await fail(CATALOG_PAID, paidBody(CATALOG_PAID));
    expect(result.shouldFallback).toBe(true);
    expect(locks).toEqual([`modelLock_${CATALOG_PAID}`]);
    expect(await auth.getProviderCredentials("cloudflare-ai", null, FREE)).toMatchObject({ connectionId: expect.any(String) });
  });

  it("rotates without an account-wide lock for a paid model outside the catalog", async () => {
    const { result, locks, stored } = await fail(UNLISTED_PAID, paidBody(UNLISTED_PAID));
    expect(result.shouldFallback).toBe(true);
    expect(locks).toEqual([]);
    expect(stored.testStatus).not.toBe("unavailable");
  });

  it("keeps the shared 403 handling for an unrelated refusal", async () => {
    expect((await fail(UNLISTED_PAID, AUTH_BODY)).locks).toEqual(["modelLock___all"]);
  });

  it("applies only to Cloudflare Workers AI 403s", () => {
    const base = { errorText: paidBody(UNLISTED_PAID), model: UNLISTED_PAID };
    expect(checkFallbackError({ ...base, status: 403, provider: "cloudflare-ai" }).modelOnly).toBe(true);
    expect(checkFallbackError({ ...base, status: 403, provider: "openai" }).modelOnly).toBeUndefined();
    expect(checkFallbackError({ ...base, status: 401, provider: "cloudflare-ai" }).modelOnly).toBeUndefined();
  });
});
