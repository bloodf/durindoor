import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Intercept only the host identity provider; production identity logic stays real.
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

let root;
let database;
let POST;
let calls;
const accounts = {
  "synthetic-session-A": { apiKey: "synthetic-iflow-key-A", expireTime: "2030-01-01" },
  "synthetic-session-B": { apiKey: "synthetic-iflow-key-B", expireTime: "2030-02-01" },
};

beforeEach(async () => {
  const temporaryParent = process.env.TMPDIR;
  if (!temporaryParent || !path.isAbsolute(temporaryParent) || os.tmpdir() !== temporaryParent) {
    throw new Error("Confined runtime must supply an absolute private TMPDIR");
  }
  root = fs.mkdtempSync(path.join(temporaryParent, "cookie-db-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) {
    vi.stubEnv(key, undefined);
  }
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url !== "https://platform.iflow.cn/api/openapi/apikey") {
      throw new Error(`Unexpected external destination: ${url}`);
    }
    const cookie = options.headers.Cookie;
    const session = /(?:^|;\s*)BXAuth=([^;]+)/.exec(cookie)?.[1];
    const account = accounts[session];
    if (!account || !["GET", "POST"].includes(options.method)) {
      throw new Error("Unexpected synthetic cookie request");
    }
    calls.push({ method: options.method, cookie, body: options.body });
    if (options.method === "POST") expect(JSON.parse(options.body)).toEqual({ name: "same-label" });
    return Response.json({
      success: true,
      data: options.method === "GET" ? { name: "same-label" } : { name: "same-label", ...account },
    });
  }));
  database = await import("@/lib/db/index.js");
  ({ POST } = await import("../../src/app/api/oauth/iflow/cookie/route.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function importSession(session) {
  const response = await POST(new Request("http://fixture.invalid/api/oauth/iflow/cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: ` BXAuth=${session}; ignored=synthetic ` }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.connection.id;
}

async function stored(id, session) {
  const row = await database.getProviderConnectionById(id);
  expect(row).toMatchObject({
    id,
    provider: "iflow",
    authType: "cookie",
    name: "same-label",
    email: "same-label",
    apiKey: accounts[session].apiKey,
    providerSpecificData: { cookie: `BXAuth=${session};`, expireTime: accounts[session].expireTime },
    testStatus: "active",
    isActive: true,
  });
  return row;
}

// Only provider HTTP is synthetic; route, export chain, encryption and DB remain real.
describe("B-01 actual iFlow cookie ingress", () => {
  it("keeps same-label distinct sessions and original credentials separate", async () => {
    const a = await importSession("synthetic-session-A");
    const original = await stored(a, "synthetic-session-A");
    const b = await importSession("synthetic-session-B");
    expect(b).not.toBe(a);
    expect(await stored(a, "synthetic-session-A")).toEqual(original);
    await stored(b, "synthetic-session-B");
    const rows = await database.getProviderConnections({ provider: "iflow" });
    expect(rows.map((row) => row.id).sort()).toEqual([a, b].sort());
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET", "POST"]);
  });

  it("reimports an identical session idempotently without adding another identity", async () => {
    const a = await importSession("synthetic-session-A");
    const again = await importSession("synthetic-session-A");
    expect(again).toBe(a);
    await stored(a, "synthetic-session-A");
    const rows = await database.getProviderConnections({ provider: "iflow" });
    expect(rows.map((row) => row.id)).toEqual([a]);
  });

  it("reimports A after same-label B without replacing B or duplicating A", async () => {
    const a = await importSession("synthetic-session-A");
    const b = await importSession("synthetic-session-B");
    const originalB = await stored(b, "synthetic-session-B");
    expect(await importSession("synthetic-session-A")).toBe(a);
    await stored(a, "synthetic-session-A");
    expect(await stored(b, "synthetic-session-B")).toEqual(originalB);
    const rows = await database.getProviderConnections({ provider: "iflow" });
    expect(rows.map((row) => row.id).sort()).toEqual([a, b].sort());
  });
});
