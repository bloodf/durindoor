import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-node-suffix-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }),
    },
  }));
  vi.doMock("@/dashboardGuard", () => ({ canManageAccessConfig: async () => true }));
  const { POST } = await import("@/app/api/provider-nodes/route.js");
  const { getProviderNodeById } = await import("@/models/index.js");
  const { disposeRequestDetailsRepo } = await import("@/lib/db/repos/requestDetailsRepo.js");
  return { POST, getProviderNodeById, disposeRequestDetailsRepo };
}

const req = (body) =>
  new Request("http://localhost/api/provider-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const base = { name: "Node", prefix: "nd", baseUrl: "https://example.test/v1" };

afterEach(() => {
  vi.doUnmock("next/server");
  vi.doUnmock("@/dashboardGuard");
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("compatible provider ID suffix (decolua/9router#4710)", { timeout: 60_000 }, () => {
  it("builds IDs from a trimmed suffix and falls back to a UUID when blank", async () => {
    const ctx = await setup();
    const chat = await ctx.POST(req({ ...base, type: "openai-compatible", apiType: "chat", providerIdSuffix: "  Team.Proxy_1-Prod  " }));
    expect(chat.status).toBe(201);
    expect((await chat.json()).node.id).toBe("openai-compatible-chat-Team.Proxy_1-Prod");

    const anthropic = await ctx.POST(req({ ...base, type: "anthropic-compatible", providerIdSuffix: "ac-prod" }));
    expect((await anthropic.json()).node.id).toBe("anthropic-compatible-ac-prod");

    for (const providerIdSuffix of [undefined, "", "   "]) {
      const res = await ctx.POST(req({ ...base, type: "openai-compatible", apiType: "chat", ...(providerIdSuffix === undefined ? {} : { providerIdSuffix }) }));
      expect(res.status).toBe(201);
      expect((await res.json()).node.id).toMatch(/^openai-compatible-chat-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
    }
    await ctx.disposeRequestDetailsRepo();
  });

  it("rejects invalid suffixes and refuses to overwrite an existing node", async () => {
    const ctx = await setup();
    const body = { ...base, type: "openai-compatible", apiType: "chat", providerIdSuffix: "shared" };
    expect((await ctx.POST(req(body))).status).toBe(201);

    const invalid = await ctx.POST(req({ ...body, providerIdSuffix: "invalid/suffix" }));
    expect(invalid.status).toBe(400);
    const nonString = await ctx.POST(req({ ...body, providerIdSuffix: 5 }));
    expect(nonString.status).toBe(400);

    const dup = await ctx.POST(req({ ...body, name: "Overwriter", baseUrl: "https://evil.test/v1" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("PROVIDER_NODE_ID_CONFLICT");
    const stored = await ctx.getProviderNodeById("openai-compatible-chat-shared");
    expect(stored.name).toBe("Node");
    expect(stored.baseUrl).toBe("https://example.test/v1");
    await ctx.disposeRequestDetailsRepo();
  });

  it("resolves legacy apiType only from the fixed responses marker, not a custom suffix", async () => {
    const { getOpenAICompatibleType } = await import("../../open-sse/services/provider.js");
    expect(getOpenAICompatibleType("openai-compatible-responses-abc")).toBe("responses");
    expect(getOpenAICompatibleType("openai-compatible-chat-my-responses-proxy")).toBe("chat");
    expect(getOpenAICompatibleType("openai-compatible-chat-x", { providerSpecificData: { apiType: "responses" } })).toBe("responses");
  });
});
