// G-a2-3 / OmniRoute #15987 + #15932: reject a conflicting compatible-node
// identity and an already-encrypted credential envelope at the provider write
// boundary.
//
// A compatible node owns its endpoint. A connection that stores a different
// baseUrl than its node sends the stored API key to a different host than the
// operator configured, so the conflict must be rejected instead of silently
// stored. A credential that is already an encrypted envelope would be stored
// as a ciphertext of a ciphertext and could never decrypt back to a usable key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  looksLikeEncryptedEnvelope,
  encryptedEnvelopeCredentialMessage,
} from "@/shared/utils/credentialEnvelope";
import {
  resolveCompatibleNodeIdentity,
  normalizeIdentityValue,
} from "@/lib/providers/compatibleNodeIdentity";

const originalDataDir = process.env.DATA_DIR;

async function setupTestContext(nodeData, { operator = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-node-identity-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  if (operator) {
    vi.doMock("@/dashboardGuard", async () => {
      const actual = await vi.importActual("@/dashboardGuard");
      return {
        ...actual,
        isOperatorRequest: async () => true,
        canManageAccessConfig: async () => true,
      };
    });
  }

  const { POST } = await import("@/app/api/providers/route.js");
  const { PUT } = await import("@/app/api/providers/[id]/route.js");
  const { createProviderNode, getProviderConnections } = await import("@/lib/localDb");
  const { disposeRequestDetailsRepo } = await import("@/lib/db/repos/requestDetailsRepo.js");

  const node = await createProviderNode(nodeData);

  return {
    node,
    POST,
    PUT,
    getProviderConnections,
    async cleanup() {
      await disposeRequestDetailsRepo();
      try { await global._dbAdapter?.instance?.close?.(); } catch { /* adapter already closed */ }
      delete global._dbAdapter;
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

const makeRequest = (provider, extras = {}) =>
  new Request("https://durindoor.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey: "sk-fixture-key", name: "Fixture", ...extras }),
  });

const makeUpdateRequest = (id, body) =>
  new Request(`https://durindoor.local/api/providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const nodeFixture = {
  id: "openai-compatible-identity",
  type: "openai-compatible",
  name: "Identity Fixture",
  prefix: "idn",
  apiType: "chat",
  baseUrl: "https://first.invalid/v1",
};

describe("compatible node identity (OmniRoute #15987)", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
    cleanup = () => {};
    vi.doUnmock("next/server");
    vi.doUnmock("@/dashboardGuard");
    vi.resetModules();
    vi.clearAllMocks();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("rejects a conflicting baseUrl on create", async () => {
    const ctx = await setupTestContext(nodeFixture);
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id, {
      providerSpecificData: { baseUrl: "https://second.invalid/v1" },
    }));
    const body = await response.json();
    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/baseUrl/);
    expect(stored).toHaveLength(0);
  });

  it.each(["prefix", "apiType", "nodeName"])("rejects a conflicting %s on create", async (field) => {
    const ctx = await setupTestContext(nodeFixture);
    cleanup = ctx.cleanup;

    const values = { prefix: "other", apiType: "responses", nodeName: "Other Node" };
    const response = await ctx.POST(makeRequest(ctx.node.id, {
      providerSpecificData: { [field]: values[field] },
    }));
    const body = await response.json();
    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(400);
    expect(body.error).toMatch(new RegExp(field));
    expect(stored).toHaveLength(0);
  });

  it("accepts an endpoint that differs only by a trailing slash", async () => {
    const ctx = await setupTestContext(nodeFixture);
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id, {
      providerSpecificData: { baseUrl: "https://first.invalid/v1/" },
    }));

    expect(response.status).toBe(201);
    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });
    expect(stored[0].providerSpecificData.baseUrl).toBe("https://first.invalid/v1");
  });

  it("keeps unrelated provider data and the node's identity on create", async () => {
    const ctx = await setupTestContext(nodeFixture);
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id, {
      providerSpecificData: { fixtureMetadata: "preserved" },
    }));

    expect(response.status).toBe(201);
    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });
    expect(stored[0].providerSpecificData.fixtureMetadata).toBe("preserved");
    expect(stored[0].providerSpecificData.baseUrl).toBe("https://first.invalid/v1");
    expect(stored[0].providerSpecificData.prefix).toBe("idn");
  });

  it("rejects a conflicting baseUrl on update", async () => {
    const ctx = await setupTestContext(nodeFixture, { operator: true });
    cleanup = ctx.cleanup;

    const created = await ctx.POST(makeRequest(ctx.node.id));
    expect(created.status).toBe(201);
    const [stored] = await ctx.getProviderConnections({ provider: ctx.node.id });

    const response = await ctx.PUT(
      makeUpdateRequest(stored.id, { providerSpecificData: { baseUrl: "https://second.invalid/v1" } }),
      { params: Promise.resolve({ id: stored.id }) },
    );
    const body = await response.json();
    const [after] = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/baseUrl/);
    expect(after.providerSpecificData.baseUrl).toBe("https://first.invalid/v1");
  });

  it("keeps the node's endpoint when an update does not touch it", async () => {
    const ctx = await setupTestContext(nodeFixture, { operator: true });
    cleanup = ctx.cleanup;

    const created = await ctx.POST(makeRequest(ctx.node.id));
    expect(created.status).toBe(201);
    const [stored] = await ctx.getProviderConnections({ provider: ctx.node.id });

    const response = await ctx.PUT(
      makeUpdateRequest(stored.id, { name: "Renamed" }),
      { params: Promise.resolve({ id: stored.id }) },
    );
    const [after] = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(200);
    expect(after.name).toBe("Renamed");
    expect(after.providerSpecificData.baseUrl).toBe("https://first.invalid/v1");
  });

  it("compares the endpoint pathname without touching the query", () => {
    expect(normalizeIdentityValue("baseUrl", "https://h/v1/?tenant=team"))
      .toBe("https://h/v1?tenant=team");
    expect(normalizeIdentityValue("baseUrl", "https://h/v1?tenant=team"))
      .toBe("https://h/v1?tenant=team");
    expect(normalizeIdentityValue("prefix", "abc")).toBe("abc");
  });

  it("treats a missing or non-record incoming payload as no incoming data", () => {
    const node = { prefix: "idn", apiType: "chat", baseUrl: "https://first.invalid/v1", name: "Identity Fixture" };
    for (const incoming of [null, undefined, "string", 42, ["array"]]) {
      const result = resolveCompatibleNodeIdentity(node, incoming, true);
      expect(result.conflict).toBeNull();
      expect(result.data.baseUrl).toBe("https://first.invalid/v1");
    }
  });

  it("reports no conflict when the incoming data agrees with the node", () => {
    const result = resolveCompatibleNodeIdentity(
      { prefix: "idn", apiType: "chat", baseUrl: "https://first.invalid/v1", name: "Identity Fixture" },
      { baseUrl: "https://first.invalid/v1/", prefix: "idn" },
      true,
    );
    expect(result.conflict).toBeNull();
    expect(result.data.baseUrl).toBe("https://first.invalid/v1");
  });
});

describe("encrypted credential envelope (OmniRoute #15932)", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
    cleanup = () => {};
    vi.doUnmock("next/server");
    vi.doUnmock("@/dashboardGuard");
    vi.resetModules();
    vi.clearAllMocks();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  const envelope = { v: 1, iv: "aXYtYmFzZTY0", ct: "Y3QtdmFsdWU" };

  it("recognizes an envelope object and its JSON string form", () => {
    expect(looksLikeEncryptedEnvelope(envelope)).toBe(true);
    expect(looksLikeEncryptedEnvelope(JSON.stringify(envelope))).toBe(true);
  });

  it("does not recognize a plaintext key", () => {
    expect(looksLikeEncryptedEnvelope("sk-live-abc123")).toBe(false);
    expect(looksLikeEncryptedEnvelope("")).toBe(false);
    expect(looksLikeEncryptedEnvelope(null)).toBe(false);
    expect(looksLikeEncryptedEnvelope(undefined)).toBe(false);
    expect(looksLikeEncryptedEnvelope("{not json")).toBe(false);
    expect(looksLikeEncryptedEnvelope(JSON.stringify({ hello: "world" }))).toBe(false);
    expect(looksLikeEncryptedEnvelope(JSON.stringify({ v: 1, iv: "", ct: "" }))).toBe(false);
  });

  it("does not recognize a non-record payload as an envelope", () => {
    for (const value of [42, true, [envelope], [1, 2, 3], () => {}]) {
      expect(looksLikeEncryptedEnvelope(value)).toBe(false);
    }
  });

  it("rejects an envelope as an apiKey on create", async () => {
    const ctx = await setupTestContext(nodeFixture);
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest("openai", { apiKey: JSON.stringify(envelope) }));
    const body = await response.json();
    const stored = await ctx.getProviderConnections({ provider: "openai" });

    expect(response.status).toBe(400);
    expect(body.error).toBe(encryptedEnvelopeCredentialMessage());
    expect(stored).toHaveLength(0);
  });

  it("still accepts a plaintext key on create", async () => {
    const ctx = await setupTestContext(nodeFixture);
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest("openai", { apiKey: "sk-live-abc123" }));

    expect(response.status).toBe(201);
    const stored = await ctx.getProviderConnections({ provider: "openai" });
    expect(stored).toHaveLength(1);
  });
});
