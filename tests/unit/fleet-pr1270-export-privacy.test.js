import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PAYLOAD_FIELDS = ["request", "providerRequest", "providerResponse", "response"];
const bodyCanaries = Object.fromEntries(PAYLOAD_FIELDS.map((field) => [
  field, `FLEET-1270-PRIVATE-${field}-BODY`,
]));
const tokenCanaries = ["FLEET-1270-BEARER-TOKEN", "FLEET-1270-API-KEY", "FLEET-1270-COOKIE"];
const metadata = { redacted: true, version: 1, present: true, type: "object", bytes: 123 };
let adapter;
let GET;
let retainedRows;

beforeAll(async () => {
  // Retained pre-redaction rows bypass today's metadata-only writer deliberately.
  // Use a real private SQLite fixture, repository generator, and registered GET.
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-pr1270-export-privacy-"));
  vi.stubEnv("DATA_DIR", privateDir);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubGlobal("_dbAdapter", { instance: null, initPromise: null, logged: false, file: null, cacheKey: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed in export privacy fixture"); }));
  vi.resetModules();
  const { openSqliteAdapter, setActiveAdapter } = await import("@/lib/db/driver.js");
  fs.mkdirSync(path.join(privateDir, "db"));
  adapter = await openSqliteAdapter(path.join(privateDir, "db", "data.sqlite"));
  // Minimal fixture schema only; no application migration or existing DB is used.
  adapter.exec(`CREATE TABLE requestDetails (
    id TEXT PRIMARY KEY, timestamp TEXT, provider TEXT, model TEXT,
    connectionId TEXT, status TEXT, data TEXT
  )`);
  setActiveAdapter(adapter);
  const common = {
    timestamp: new Date(Date.now() - 1_000).toISOString(),
    provider: "openai", model: "fleet-synthetic-model", connectionId: "fleet-synthetic-connection",
    status: "success", latency: { totalMs: 42 }, tokens: { input: 10, output: 20 },
  };
  retainedRows = [
    {
      ...common, id: "retained-legacy-bodies",
      ...Object.fromEntries(PAYLOAD_FIELDS.map((field) => [field, { content: bodyCanaries[field] }])),
    },
    {
      ...common, id: "retained-legacy-credentials",
      request: {
        headers: {
          authorization: `Bearer ${tokenCanaries[0]}`,
          "x-api-key": tokenCanaries[1], cookie: `session=${tokenCanaries[2]}`,
        },
      },
    },
    {
      ...common, id: "retained-metadata-only",
      ...Object.fromEntries(PAYLOAD_FIELDS.map((field) => [field, metadata])),
    },
    {
      ...common, id: "retained-untrusted-metadata",
      request: { ...metadata, preview: bodyCanaries.request, headers: { authorization: tokenCanaries[0] } },
      providerRequest: { ...metadata, type: tokenCanaries[1], bytes: -1 },
      providerResponse: { ...metadata, version: 2, preview: bodyCanaries.providerResponse },
      response: { ...metadata, bytes: 1.5, present: "private" },
    },
    {
      ...common, id: "retained-payload-types",
      request: null, providerRequest: bodyCanaries.providerRequest,
      providerResponse: [bodyCanaries.providerResponse], response: false,
    },
  ];
  for (const row of retainedRows) {
    adapter.run(
      "INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)",
      [row.id, row.timestamp, row.provider, row.model, row.connectionId, row.status, JSON.stringify(row)],
    );
  }
  ({ GET } = await import("../../src/app/api/logs/export/route.js"));
}, 30_000);

afterAll(async () => {
  await adapter?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  // Keep the disposable DB under the wrapper's private TMPDIR for repro evidence.
});

async function exportRetainedLogs() {
  const response = await GET(new Request("http://localhost/api/logs/export?hours=24&limit=10"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  const text = await response.text();
  const body = JSON.parse(text);
  expect(body).toMatchObject({ count: retainedRows.length, hours: 24, type: "request-logs" });
  expect(body.logs.map((row) => row.id).sort()).toEqual(retainedRows.map((row) => row.id).sort());
  expect(globalThis.fetch).not.toHaveBeenCalled();
  return { text, body };
}

describe("retained request-log export privacy through GET /api/logs/export", () => {
  it("does not export legacy request, provider request, provider response, or response bodies", async () => {
    const { text } = await exportRetainedLogs();
    for (const canary of Object.values(bodyCanaries)) {
      expect.soft(text).not.toContain(canary);
    }
  });

  it("does not export credentials retained inside legacy request headers", async () => {
    const { text } = await exportRetainedLogs();
    for (const canary of tokenCanaries) {
      expect.soft(text).not.toContain(canary);
    }
  });

  it("preserves content-free payload metadata and useful token counts", async () => {
    const { body } = await exportRetainedLogs();
    const exported = body.logs.find((row) => row.id === "retained-metadata-only");
    expect(exported).toEqual(retainedRows.find((row) => row.id === "retained-metadata-only"));
    for (const field of PAYLOAD_FIELDS) expect(exported[field]).toEqual(metadata);
    expect(exported.tokens).toEqual({ input: 10, output: 20 });
    expect(exported.latency).toEqual({ totalMs: 42 });
  });

  it("projects legacy values and strips untrusted metadata extras without changing stored rows", async () => {
    const { body, text } = await exportRetainedLogs();
    const legacy = body.logs.find((row) => row.id === "retained-legacy-bodies");
    for (const field of PAYLOAD_FIELDS) {
      expect(legacy[field]).toEqual({ redacted: true, version: 1, present: true, type: "object" });
    }
    const untrusted = body.logs.find((row) => row.id === "retained-untrusted-metadata");
    expect(untrusted.request).toEqual(metadata);
    expect(untrusted.providerRequest).toEqual({ redacted: true, version: 1, present: true, type: "object" });
    expect(untrusted.providerResponse).toEqual({ redacted: true, version: 1, present: true, type: "object" });
    expect(untrusted.response).toEqual({ redacted: true, version: 1, present: false, type: "object" });
    const types = body.logs.find((row) => row.id === "retained-payload-types");
    for (const [field, type] of Object.entries({ request: "none", providerRequest: "string", providerResponse: "array", response: "boolean" })) {
      expect(types[field]).toEqual({ redacted: true, version: 1, present: field !== "request", type });
    }
    const credentials = body.logs.find((row) => row.id === "retained-legacy-credentials");
    expect(credentials).not.toHaveProperty("providerRequest");
    for (const canary of [...Object.values(bodyCanaries), ...tokenCanaries]) expect(text).not.toContain(canary);
    for (const row of retainedRows) {
      expect(JSON.parse(adapter.get("SELECT data FROM requestDetails WHERE id = ?", [row.id]).data)).toEqual(row);
    }
  });
});
