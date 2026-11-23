import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Antigravity capability-hint persistence and route fingerprint (#2034).
 *
 * Upstream provenance (MIT):
 * - router-for-me/CLIProxyAPI @ 6960763455c4ac3d4828fb1736aa5de2183ccecf
 *   `sdk/auth/antigravity_models.go`
 *   (`BuildPersistedAntigravityCapabilityHints`,
 *   `ParsePersistedAntigravityCapabilityHints`,
 *   `AntigravityCapabilityRouteFingerprint`)
 * - cheaper-inference/OmniRoute @ 5ffa68e83544 (release/v3.8.55 line)
 *   account-scoped `fetchAvailableModels` body and caching contract
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ag-hints-"));
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

function catalogResponse(models, extra = {}) {
  return Response.json({ models, ...extra });
}

beforeAll(async () => {
  route = await import("@/app/api/providers/[id]/models/route.js");
  db = await import("@/lib/localDb");
  catalog = await import("open-sse/services/antigravityCatalog.js");
  // The models route pulls in most of the app; a cold import exceeds the 10s default hook timeout under parallel load.
}, 60_000);

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
    email: "hints@example.test",
    accessToken: "hints-token",
    refreshToken: "hints-refresh",
    projectId: "project-hints",
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

describe("Antigravity capability hints and transport fingerprint", () => {
  it("persists and reuses hints per connection and project", async () => {
    providerFetch.mockImplementation(async () => catalogResponse({
      "gemini-3-flash": { displayName: "Flash" },
      "claude-sonnet-4": { displayName: "Sonnet" }
    }, { webSearchModelIds: ["gemini-3-flash"] }));

    const connection = await addConnection({ email: "persist@example.test" });
    const first = await getModels(connection.id);
    expect(first.response.status).toBe(200);
    expect(first.body.models.map((m) => m.id).sort()).toEqual(["claude-sonnet-4", "gemini-3-flash"]);
    expect(first.body.routeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(providerFetch).toHaveBeenCalledTimes(1);

    const stored = await db.getProviderConnectionById(connection.id);
    const hints = stored.providerSpecificData?.[catalog.ANTIGRAVITY_CAPABILITY_HINTS_META_KEY];
    expect(hints).toMatchObject({
      project_id: "project-hints",
      endpoint: "https://daily-cloudcode-pa.googleapis.com",
      route_fingerprint: first.body.routeFingerprint
    });
    expect(hints.model_ids.sort()).toEqual(["claude-sonnet-4", "gemini-3-flash"]);
    expect(hints.web_search_model_ids).toEqual(["gemini-3-flash"]);
    expect(hints.route_fingerprint).not.toMatch(/hints-token|hints-refresh|password/i);

    providerFetch.mockImplementation(async () => {
      throw new Error("must not probe when hints are reusable");
    });
    const reused = await getModels(connection.id);
    expect(reused.response.status).toBe(200);
    expect(reused.body.source).toBe("persisted_capability_hints");
    expect(reused.body.models.map((m) => m.id)).toEqual(["claude-sonnet-4", "gemini-3-flash"]);
    expect(reused.body.routeFingerprint).toBe(first.body.routeFingerprint);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("isolates hints between connections and projects", async () => {
    providerFetch.mockImplementation(async () => catalogResponse({ "model-a": {} }));
    const one = await addConnection({
      email: "one@example.test",
      accessToken: "token-one",
      projectId: "project-one"
    });
    const two = await addConnection({
      email: "two@example.test",
      accessToken: "token-two",
      projectId: "project-two"
    });

    await getModels(one.id);
    providerFetch.mockImplementation(async () => catalogResponse({ "model-b": {} }));
    await getModels(two.id);

    const storedOne = await db.getProviderConnectionById(one.id);
    const storedTwo = await db.getProviderConnectionById(two.id);
    expect(storedOne.providerSpecificData.antigravity_capability_hints.project_id).toBe("project-one");
    expect(storedOne.providerSpecificData.antigravity_capability_hints.model_ids).toEqual(["model-a"]);
    expect(storedTwo.providerSpecificData.antigravity_capability_hints.project_id).toBe("project-two");
    expect(storedTwo.providerSpecificData.antigravity_capability_hints.model_ids).toEqual(["model-b"]);

    providerFetch.mockClear();
    providerFetch.mockImplementation(async () => {
      throw new Error("must not cross-read another connection's hints");
    });
    const reuseOne = await getModels(one.id);
    const reuseTwo = await getModels(two.id);
    expect(reuseOne.body.models.map((m) => m.id)).toEqual(["model-a"]);
    expect(reuseTwo.body.models.map((m) => m.id)).toEqual(["model-b"]);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("applies the route fingerprint on catalog requests and invalidates on route change", async () => {
    const directFp = catalog.antigravityCapabilityRouteFingerprint(
      "",
      "antigravity/hub/2.33.0 darwin/arm64"
    );
    const proxyFp = catalog.antigravityCapabilityRouteFingerprint(
      "http://user:secret@proxy.example:8080",
      "antigravity/hub/2.33.0 darwin/arm64"
    );
    expect(directFp).toMatch(/^[a-f0-9]{64}$/);
    expect(proxyFp).toMatch(/^[a-f0-9]{64}$/);
    expect(proxyFp).not.toBe(directFp);
    expect(proxyFp).not.toContain("secret");
    expect(catalog.antigravityCapabilityRouteFingerprint("http://other:8080", "antigravity/hub/2.33.0 darwin/arm64"))
      .not.toBe(proxyFp);
    expect(catalog.antigravityCapabilityRouteFingerprint("http://proxy.example:8080", "   ")).toBe("");

    providerFetch.mockImplementation(async () => catalogResponse({ "gemini-3-flash": {} }));
    const connection = await addConnection({
      email: "fp@example.test",
      providerSpecificData: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://user:secret@proxy.example:8080"
      }
    });
    const probed = await getModels(connection.id);
    expect(probed.body.routeFingerprint).toBe(proxyFp);
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const probeHeaders = new Headers(providerFetch.mock.calls[0][1].headers);
    expect(probeHeaders.get("user-agent")).toBe("antigravity/hub/2.33.0 darwin/arm64");
    expect(String(providerFetch.mock.calls[0][0])).toBe(CATALOG_URL);

    // Same proxy route reuses hints.
    providerFetch.mockClear();
    const reused = await getModels(connection.id);
    expect(reused.body.source).toBe("persisted_capability_hints");
    expect(providerFetch).not.toHaveBeenCalled();

    // A different egress contract must probe again and rewrite the fingerprint.
    await db.updateProviderConnection(connection.id, {
      providerSpecificData: {
        connectionProxyEnabled: false,
        connectionProxyUrl: ""
      }
    });
    providerFetch.mockImplementation(async () => catalogResponse({ "gemini-3-pro": {} }));
    const refreshed = await getModels(connection.id);
    expect(refreshed.body.routeFingerprint).toBe(directFp);
    expect(refreshed.body.models.map((m) => m.id)).toEqual(["gemini-3-pro"]);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to persist an unknown catalog as an authoritative empty set", () => {
    expect(catalog.buildPersistedAntigravityCapabilityHints("p", "https://daily-cloudcode-pa.googleapis.com", {
      modelIds: null,
      webSearchModelIds: new Set()
    })).toBeNull();

    const empty = catalog.buildPersistedAntigravityCapabilityHints("p", "https://user:pass@daily-cloudcode-pa.googleapis.com/", {
      modelIds: new Set(),
      webSearchModelIds: new Set(),
      routeFingerprint: "abc"
    });
    expect(empty).toEqual({
      model_ids: [],
      project_id: "p",
      endpoint: "https://daily-cloudcode-pa.googleapis.com",
      route_fingerprint: "abc",
      web_search_model_ids: []
    });
  });
});
