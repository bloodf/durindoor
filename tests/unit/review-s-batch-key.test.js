import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ key: null, dispatch: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: async (secret) => state.key?.key === secret ? state.key : null,
  getApiKeyById: async (id) => state.key?.id === id ? state.key : null,
}));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: async () => null }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: state.dispatch }));
vi.mock("@/sse/handlers/embeddings.js", () => ({ handleEmbeddings: state.dispatch }));

const { resolveClientApiKey } = await import("@/sse/services/auth.js");
const { enforceApiKeyModelPolicy } = await import("@/sse/services/apiKeyPolicy.js");
const { makeDefaultExecutor } = await import("open-sse/handlers/localBatchExecutor.js");
const row = { url: "/v1/chat/completions", body: { model: "anthropic/claude" } };

async function admittedExecutor() {
  const request = new Request("http://localhost/v1/batches", { headers: { authorization: "Bearer original" } });
  expect((await resolveClientApiKey(request)).auth.apiKeyId).toBe("key-id");
  return makeDefaultExecutor(request);
}

describe("batch key identity", () => {
  beforeEach(() => {
    state.key = { id: "key-id", key: "original", isActive: true, policy: { allowedModels: ["openai/gpt-4o-mini"] } };
    state.dispatch.mockReset().mockImplementation(async (request) => {
      const { apiKey, auth } = await resolveClientApiKey(request);
      const key = state.key?.key === apiKey ? state.key : null;
      return Response.json({ id: auth.apiKeyId, policy: key?.policy }, { status: key?.policy ? 403 : 200 });
    });
  });

  it("retains the current policy and identity after rotation", async () => {
    const execute = await admittedExecutor();
    state.key = { ...state.key, key: "rotated", policy: { allowedModels: ["other"] } };
    const result = await execute(row);
    expect(result).toMatchObject({ status_code: 403, body: { id: "key-id", policy: { allowedModels: ["other"] } } });
  });

  it("checks policy by id if rotation happens after row admission", async () => {
    const execute = await admittedExecutor();
    state.dispatch.mockImplementation(async (request) => {
      const { apiKey } = await resolveClientApiKey(request);
      state.key = { ...state.key, key: "rotated" };
      return await enforceApiKeyModelPolicy(request, "anthropic/claude", apiKey) || Response.json({});
    });
    expect((await execute(row)).status_code).toBe(403);
  });

  it.each(["deleted", "inactive", "expired"])("rejects a %s key before dispatch", async (change) => {
    const execute = await admittedExecutor();
    if (change === "deleted") state.key = null;
    else if (change === "inactive") state.key.isActive = false;
    else state.key.expiresAt = "2000-01-01T00:00:00Z";
    expect((await execute(row)).status_code).toBe(401);
    expect(state.dispatch).not.toHaveBeenCalled();
  });

  it("keeps keyless local batches unchanged", async () => {
    const request = new Request("http://localhost/v1/batches");
    await resolveClientApiKey(request);
    expect((await makeDefaultExecutor(request)(row)).status_code).toBe(200);
  });
});
