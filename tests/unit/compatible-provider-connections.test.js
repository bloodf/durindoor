import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupTestContext(nodeData) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-compatible-provider-"));
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

  const { POST } = await import("@/app/api/providers/route.js");
  const {
    createProviderNode,
    getProviderConnections,
  } = await import("@/models/index.js");

  const node = await createProviderNode(nodeData);

  return {
    node,
    POST,
    getProviderConnections,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeRequest(provider, name = "Test Connection", extras = {}) {
  return new Request("https://9router.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      apiKey: "test-key",
      name,
      defaultModel: "test-model",
      ...extras,
    }),
  });
}

function expectCompatibleConnection(connection, node, { apiType } = {}) {
  expect(connection.provider).toBe(node.id);
  expect(connection.authType).toBe("apikey");
  expect(connection.defaultModel).toBe("test-model");
  expect(connection.providerSpecificData).toMatchObject({
    prefix: node.prefix,
    baseUrl: node.baseUrl,
    nodeName: node.name,
  });

  if (apiType !== undefined) {
    expect(connection.providerSpecificData.apiType).toBe(apiType);
  }
}

describe("compatible provider connections API", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("creates one API-key connection for an OpenAI-compatible node", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-test",
      type: "openai-compatible",
      name: "OpenAI Compatible Test Node",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://openai-compatible.test/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id));
    const body = await response.json();
    const connection = body.connection;
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(201);
    expect(storedConnections).toHaveLength(1);
    expectCompatibleConnection(connection, ctx.node, { apiType: "chat" });
    expect(storedConnections[0]).toMatchObject({
      provider: ctx.node.id,
      authType: "apikey",
      defaultModel: "test-model",
      providerSpecificData: {
        prefix: ctx.node.prefix,
        apiType: "chat",
        baseUrl: ctx.node.baseUrl,
        nodeName: ctx.node.name,
      },
    });
  });

  it("creates a no-auth connection for a free provider without an API key", async () => {
    const ctx = await setupTestContext({
      id: "mimocode",
      type: "free",
      name: "MiMoCode",
      prefix: "mcode",
      baseUrl: "https://api.xiaomimimo.com/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest("mimocode", "Mimocode rotation", { apiKey: "", providerSpecificData: { fingerprints: ["fp-a"] } }));
    const body = await response.json();
    const storedConnections = await ctx.getProviderConnections({ provider: "mimocode" });

    expect(response.status).toBe(201);
    expect(storedConnections).toHaveLength(1);
    expect(storedConnections[0]).toMatchObject({
      provider: "mimocode",
      authType: "apikey",
      name: "Mimocode rotation",
      providerSpecificData: {
        fingerprints: ["fp-a"],
      },
    });
    expect(body.connection.apiKey).toBeUndefined();
  });
  it("creates one API-key connection for an Anthropic-compatible node", async () => {
    const ctx = await setupTestContext({
      id: "anthropic-compatible-test",
      type: "anthropic-compatible",
      name: "Anthropic Compatible Test Node",
      prefix: "act",
      baseUrl: "https://anthropic-compatible.test/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest(ctx.node.id));
    const body = await response.json();
    const connection = body.connection;
    const storedConnections = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(response.status).toBe(201);
    expect(storedConnections).toHaveLength(1);
    expectCompatibleConnection(connection, ctx.node);
    expect(storedConnections[0]).toMatchObject({
      provider: ctx.node.id,
      authType: "apikey",
      defaultModel: "test-model",
      providerSpecificData: {
        prefix: ctx.node.prefix,
        baseUrl: ctx.node.baseUrl,
        nodeName: ctx.node.name,
      },
    });
  });

  it("allows multiple connections on the same compatible node", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-multi-test",
      type: "openai-compatible",
      name: "Multi Connection Node",
      prefix: "mcn",
      apiType: "chat",
      baseUrl: "https://multi-guard.test/v1",
    });
    cleanup = ctx.cleanup;

    const res1 = await ctx.POST(makeRequest(ctx.node.id));
    const res2 = await ctx.POST(makeRequest(ctx.node.id, "Test Connection 2"));
    const stored = await ctx.getProviderConnections({ provider: ctx.node.id });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(stored).toHaveLength(2);
    stored.forEach(c => expectCompatibleConnection(c, ctx.node, { apiType: "chat" }));
  });

  it("rejects hidden built-in API-key providers in the legacy creation API", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-hidden-guard",
      type: "openai-compatible",
      name: "Hidden Guard Node",
      prefix: "hgn",
      apiType: "chat",
      baseUrl: "https://hidden-guard.test/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest("databricks"));
    const body = await response.json();
    const storedConnections = await ctx.getProviderConnections({ provider: "databricks" });

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid provider" });
    expect(storedConnections).toHaveLength(0);
  });

  it("continues creating visible built-in API-key providers in the legacy creation API", async () => {
    const ctx = await setupTestContext({
      id: "openai-compatible-visible-guard",
      type: "openai-compatible",
      name: "Visible Guard Node",
      prefix: "vgn",
      apiType: "chat",
      baseUrl: "https://visible-guard.test/v1",
    });
    cleanup = ctx.cleanup;

    const response = await ctx.POST(makeRequest("openai"));
    const body = await response.json();
    const storedConnections = await ctx.getProviderConnections({ provider: "openai" });

    expect(response.status).toBe(201);
    expect(body.connection).toMatchObject({
      provider: "openai",
      authType: "apikey",
      name: "Test Connection",
    });
    expect(body.connection.apiKey).toBeUndefined();
    expect(storedConnections).toHaveLength(1);
  });
});
