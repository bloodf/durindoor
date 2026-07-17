import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

// #6499 — adding a second API-key connection for the same provider used to
// silently OVERWRITE the first: createProviderConnection upserts by
// (provider, authType=apikey, name), so a duplicate POST merged the new key
// onto the existing row with no warning. The POST /api/providers route now
// runs the create in create-only mode (atomic inside the repo transaction) and
// returns 409, leaving the original connection untouched; the explicit update
// path (PUT /api/providers/[id]) still applies changes.

const originalDataDir = process.env.DATA_DIR;

async function setupTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-6499-"));
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
  const { PUT } = await import("@/app/api/providers/[id]/route.js");
  const { getProviderConnections, getProviderConnectionById } = await import("@/models/index.js");

  return {
    POST,
    PUT,
    getProviderConnections,
    getProviderConnectionById,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function postRequest({ name, apiKey, provider = "groq" }) {
  return new Request("https://durindoor.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, name }),
  });
}

function putRequest(id, body) {
  return new Request(`https://durindoor.local/api/providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/providers - API-key connection name collision (#6499)", () => {
  let cleanup = () => {};

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  // Single sequential flow covering the acceptance contract: POST new → 201,
  // duplicate → 409 (original untouched), PUT → 200. Cold run: Next route +
  // models + DB migrations take a while under Node 20.
  it("creates new (201), rejects duplicate (409, original key unchanged), keeps PUT as explicit update (200)", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;

    // NEW — first use of the name creates the connection.
    const first = await ctx.POST(postRequest({ name: "main", apiKey: "gsk-first" }));
    expect(first.status).toBe(201);
    const { connection: created } = await first.json();
    expect(created).toMatchObject({ provider: "groq", authType: "apikey", name: "main" });
    expect(await ctx.getProviderConnections({ provider: "groq" })).toHaveLength(1);

    // DUPLICATE — same (provider, apikey, name) must NOT silently overwrite.
    const duplicate = await ctx.POST(postRequest({ name: "main", apiKey: "gsk-second" }));
    expect(duplicate.status).toBe(409);
    const dupBody = await duplicate.json();
    expect(dupBody.code).toBe("PROVIDER_CONNECTION_ALREADY_EXISTS");

    // Overwrite prevention: still exactly one row, still the FIRST key.
    let stored = await ctx.getProviderConnections({ provider: "groq" });
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(created.id);
    expect(stored[0].apiKey).toBe("gsk-first");

    // Whitespace-normalized duplicate: the route trims names, so " main "
    // collides with "main" rather than creating a lookalike row.
    const padded = await ctx.POST(postRequest({ name: " main ", apiKey: "gsk-padded" }));
    expect(padded.status).toBe(409);
    expect(await ctx.getProviderConnections({ provider: "groq" })).toHaveLength(1);

    // Same name on a DIFFERENT provider is a different collision scope → 201.
    const other = await ctx.POST(postRequest({ name: "main", apiKey: "gsk-other", provider: "openrouter" }));
    expect(other.status).toBe(201);

    // Non-string name is rejected with 400, not a 500 from `.trim`.
    const badType = await ctx.POST(new Request("https://durindoor.local/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "groq", apiKey: "gsk-x", name: 123 }),
    }));
    expect(badType.status).toBe(400);

    // UPDATE — PUT by id remains the explicit update path.
    const update = await ctx.PUT(putRequest(created.id, { apiKey: "gsk-rotated", defaultModel: "llama-3.3-70b" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(update.status).toBe(200);
    const updateBody = await update.json();
    expect(updateBody.connection.id).toBe(created.id);
    expect(updateBody.connection.defaultModel).toBe("llama-3.3-70b");

    stored = [await ctx.getProviderConnectionById(created.id)];
    expect(stored[0].apiKey).toBe("gsk-rotated");
    expect(stored[0].name).toBe("main");
  }, 30000);
});
