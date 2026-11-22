import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Antigravity account-scoped model discovery (#2034).
 *
 * The dashboard provider-models configuration used to post an empty body to
 * Cloud Code's available-models RPC. The RPC only answers for the account's
 * own project, so the answer was not the signed-in account's catalog.
 *
 * Upstream provenance, router-for-me/CLIProxyAPI pinned at
 * 6faa8d20b2673404cff70a2f2d9537ae0d0e684d,
 * `sdk/auth/antigravity_models.go`:
 * - `AntigravityModelBaseURLDaily` / `AntigravityModelsPath` — the endpoint.
 * - `FetchAntigravityAvailableModels` — body `{"project": "<id>"}`, bearer
 *   authorization, and the three probe statuses.
 * - `ParseAntigravityModelCapabilityHints` — the payload shape, where an
 *   absent `models` object is unknown and `{}` is an empty catalog.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ag-catalog-"));
const previous = { ...process.env };
process.env.DATA_DIR = tempDir;

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => Response.json(body, init) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));

const providerFetch = vi.fn(async () => {
  throw new Error("Unexpected outbound request");
});
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (...args) => providerFetch(...args),
}));

let route, db, catalog;

const CATALOG_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

function catalogResponse(models) {
  return Response.json({ models });
}

function lastProbe() {
  const call = providerFetch.mock.calls.at(-1);
  return {
    url: String(call[0]),
    options: call[1],
    body: JSON.parse(call[1].body),
    headers: new Headers(call[1].headers)
  };
}

beforeAll(async () => {
  route = await import("@/app/api/providers/[id]/models/route.js");
  db = await import("@/lib/localDb");
  catalog = await import("open-sse/services/antigravityCatalog.js");
});

beforeEach(() => {
  providerFetch.mockReset();
  providerFetch.mockImplementation(async () => {
    throw new Error("Unexpected outbound request");
  });
});

afterAll(() => {
  process.env = previous;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function addConnection(overrides = {}) {
  return db.createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    email: "catalog@example.test",
    accessToken: "catalog-token",
    refreshToken: "catalog-refresh",
    projectId: "project-catalog",
    ...overrides
  });
}

async function getModels(connectionId) {
  const response = await route.GET(
    new Request(`http://localhost/api/providers/${connectionId}/models`),
    { params: Promise.resolve({ id: connectionId }) }
  );
  return { response, body: await response.json() };
}

describe("Antigravity account-scoped catalog discovery", () => {
  it("sends each account's own project and bearer to the pinned provider endpoint", async () => {
    providerFetch.mockImplementation(async () => catalogResponse({
      "gemini-3-flash": { displayName: "Flash" }
    }));

    const first = await addConnection({ email: "one@example.test", accessToken: "token-one", projectId: "project-one" });
    const second = await addConnection({ email: "two@example.test", accessToken: "token-two", projectId: "project-two" });

    const one = await getModels(first.id);
    const two = await getModels(second.id);

    expect(one.response.status).toBe(200);
    expect(two.response.status).toBe(200);
    expect(one.body.models).toEqual([{ id: "gemini-3-flash", name: "Flash", contextLength: undefined, maxOutputTokens: undefined, supportsVision: false, supportsReasoning: false }]);

    const firstProbe = lastProbe();
    expect(firstProbe.url).toBe(CATALOG_URL);
    expect(firstProbe.body).toEqual({ project: "project-two" });
    expect(firstProbe.headers.get("authorization")).toBe("Bearer token-two");
    // The Hub identity travels with the probe.
    expect(firstProbe.headers.get("user-agent")).toBe("antigravity/hub/2.24.0 darwin/arm64");
    expect(firstProbe.headers.get("x-client-name")).toBe("antigravity");

    // Each account reads its own catalog, never the other account's project.
    const probes = providerFetch.mock.calls.map(([url, options]) => ({
      url: String(url),
      body: JSON.parse(options.body),
      bearer: new Headers(options.headers).get("authorization")
    }));
    expect(probes).toHaveLength(2);
    expect(probes.every((probe) => probe.url === CATALOG_URL)).toBe(true);
    expect(probes.map((probe) => probe.body)).toEqual([{ project: "project-one" }, { project: "project-two" }]);
    expect(probes.map((probe) => probe.bearer)).toEqual(["Bearer token-one", "Bearer token-two"]);
  });

  it("omits an invalid project instead of sending a placeholder", async () => {
    providerFetch.mockImplementation(async () => catalogResponse({ "gemini-3-flash": {} }));

    const blank = await addConnection({ email: "blank@example.test", projectId: "   " });
    const wrongShape = await addConnection({ email: "shape@example.test", projectId: { unexpected: true } });
    const numeric = await addConnection({ email: "numeric@example.test", projectId: 42 });

    for (const connection of [blank, wrongShape, numeric]) {
      const { response } = await getModels(connection.id);
      expect(response.status).toBe(200);
      expect(lastProbe().body).toEqual({});
    }
  });

  it("keeps a valid project from either connection field", async () => {
    providerFetch.mockImplementation(async () => catalogResponse({ "gemini-3-flash": {} }));

    const fromColumn = await addConnection({ email: "column@example.test", projectId: "  project-column  " });
    const fromMetadata = await addConnection({
      email: "metadata@example.test",
      projectId: "",
      providerSpecificData: { projectId: { id: "project-metadata" } }
    });

    await getModels(fromColumn.id);
    expect(lastProbe().body).toEqual({ project: "project-column" });

    await getModels(fromMetadata.id);
    expect(lastProbe().body).toEqual({ project: "project-metadata" });
  });

  it("classifies an auth rejection apart from a transient upstream failure", async () => {
    providerFetch.mockImplementation(async () => new Response("token expired", { status: 401 }));
    const connection = await addConnection({ email: "auth@example.test" });

    const auth = await getModels(connection.id);
    expect(auth.response.status).toBe(401);
    expect(auth.body.classification).toBe("auth_error");
    expect(catalog.classifyAntigravityCatalogStatus(401)).toBe("auth_error");
    expect(catalog.classifyAntigravityCatalogStatus(403)).toBe("forbidden");

    providerFetch.mockImplementation(async () => new Response("upstream busy", { status: 503 }));
    const transient = await getModels(connection.id);
    expect(transient.response.status).toBe(503);
    expect(transient.body.classification).toBe("transient");
    expect(catalog.classifyAntigravityCatalogStatus(503)).toBe("transient");
    expect(catalog.classifyAntigravityCatalogStatus(200)).toBe("success");
  });

  it("backs off a forbidden project across token rotation while isolating other projects", async () => {
    const { fetchConnectionModels } = await import("@/app/api/providers/[id]/models/fetchConnectionModels.js");
    const connection = await addConnection({ email: "forbidden@example.test" });
    providerFetch.mockResolvedValueOnce(new Response("project forbidden", { status: 403 }));
    const first = await getModels(connection.id);
    expect(first.response.status).toBe(403);
    expect(first.body.classification).toBe("forbidden");
    const rotated = await fetchConnectionModels({ ...connection, accessToken: "rotated" });
    expect(rotated).toMatchObject({ status: 403, classification: "forbidden" });
    expect(providerFetch).toHaveBeenCalledTimes(1);
    providerFetch.mockResolvedValueOnce(catalogResponse({ other: {} }));
    expect((await fetchConnectionModels({ ...connection, projectId: "another-project" })).models[0].id).toBe("other");
  });

  it("reads a malformed catalog as a transient failure instead of an empty catalog", async () => {
    const connection = await addConnection({ email: "malformed@example.test" });

    providerFetch.mockImplementation(async () => new Response("{not json", { status: 200 }));
    const broken = await getModels(connection.id);
    expect(broken.response.status).toBe(502);
    expect(broken.body.classification).toBe("transient");
    expect(broken.body.models).toBeUndefined();

    // A payload whose `models` is not a catalog object is unknown too. The
    // old parser turned a string into bogus one-character model rows.
    providerFetch.mockImplementation(async () => Response.json({ models: "not-a-catalog" }));
    const notACatalog = await getModels(connection.id);
    expect(notACatalog.response.status).toBe(502);
    expect(notACatalog.body.classification).toBe("transient");
    expect(notACatalog.body.models).toBeUndefined();

    // An absent `models` object is unknown; an empty one is an empty catalog.
    providerFetch.mockImplementation(async () => Response.json({}));
    const unknown = await getModels(connection.id);
    expect(unknown.response.status).toBe(502);
    expect(unknown.body.classification).toBe("transient");

    providerFetch.mockImplementation(async () => Response.json({ models: {} }));
    const empty = await getModels(connection.id);
    expect(empty.response.status).toBe(200);
    expect(empty.body.models).toEqual([]);
  });

  it("keeps a known catalog when a later probe fails", async () => {
    const connection = await addConnection({ email: "known@example.test" });

    providerFetch.mockImplementation(async () => catalogResponse({ "gemini-3-flash": { displayName: "Flash" } }));
    const fresh = await getModels(connection.id);
    expect(fresh.body.models.map((model) => model.id)).toEqual(["gemini-3-flash"]);

    // After a successful probe the account's capability hints are persisted.
    // A later GET reuses them instead of replacing a known catalog with a
    // transient upstream failure.
    providerFetch.mockImplementation(async () => new Response("upstream busy", { status: 503 }));
    const reused = await getModels(connection.id);
    expect(reused.response.status).toBe(200);
    expect(reused.body.source).toBe("persisted_capability_hints");
    expect(reused.body.models.map((model) => model.id)).toEqual(["gemini-3-flash"]);

    // Without reusable hints, a later transient failure must not answer with
    // an empty catalog that would replace the catalog the dashboard already knows.
    await db.updateProviderConnection(connection.id, {
      providerSpecificData: { antigravity_capability_hints: null }
    });
    providerFetch.mockImplementation(async () => new Response("upstream busy", { status: 503 }));
    const failed = await getModels(connection.id);
    expect(failed.response.status).toBe(503);
    expect(failed.body.models).toBeUndefined();

    // The auto-sync path keeps the previous catalog on a failed attempt.
    const { saveSyncedModelCatalog, getSyncedModelCatalog } = db;
    await saveSyncedModelCatalog("antigravity", {
      syncedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      connectionId: connection.id,
      error: null,
      newModelIds: [],
      removedModelIds: [],
      models: [{ id: "gemini-3-flash", name: "Flash", kind: "llm" }]
    });
    const { syncProviderModels } = await import("@/lib/modelAutoSync/runner.js");
    const result = await syncProviderModels("antigravity", {
      now: Date.now(),
      fetchModels: async () => ({ error: "Antigravity API error: 503", status: 503 })
    });
    expect(result.status).toBe("failed");
    const stored = await getSyncedModelCatalog("antigravity");
    expect(stored.models.map((model) => model.id)).toEqual(["gemini-3-flash"]);
    expect(stored.error).toContain("503");
    await syncProviderModels("antigravity", {
      now: Date.now(),
      fetchModels: async () => ({ error: "project forbidden", status: 403, classification: "forbidden" })
    });
    expect((await getSyncedModelCatalog("antigravity")).models.map((model) => model.id)).toEqual(["gemini-3-flash"]);
  });
});
