// Regression guard for OmniRoute #6562 (ported as durindoor #6626) — editing a
// provider connection whose auto-incremented `priority` has grown past the old
// 100 ceiling must validate and persist, while a genuinely out-of-range value
// is rejected with the source's "Invalid request" envelope.
//
// Root cause (upstream): `priority` auto-increments unbounded on creation
// (`MAX(priority)+1` per provider — durindoor's connectionsRepo does the same),
// and bulk OAuth account rotation routinely exceeds 100 connections per
// provider. The edit UI always round-trips the connection's current priority
// unchanged, so a UI-only `max(100)` ceiling rejected every re-save of an
// already-valid persisted priority. The ceiling is now `max(100_000)` on both
// `priority` and `globalPriority`, faithful to the source schema
// (`z.coerce.number().int().min(1).max(100_000)`), and body validation runs
// before the connection lookup exactly as in the source route.
import { beforeEach, describe, it, expect, vi } from "vitest";

const getProviderConnectionById = vi.hoisted(() => vi.fn());
const updateProviderConnection = vi.hoisted(() => vi.fn());
const getProxyPoolById = vi.hoisted(() => vi.fn());
const deleteProviderConnection = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({
  getProviderConnectionById,
  updateProviderConnection,
  getProxyPoolById,
  deleteProviderConnection,
}));

vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: vi.fn(),
}));

import { PUT } from "../../src/app/api/providers/[id]/route.js";

function makeConnection(overrides = {}) {
  return {
    id: "conn-1",
    provider: "codex",
    authType: "oauth",
    name: "Codex (imported)",
    email: "user@example.com",
    priority: 142,
    isActive: true,
    providerSpecificData: {
      workspaceId: "workspace-abc",
      chatgptUserId: "user-123",
      requestDefaults: { reasoningEffort: "medium" },
    },
    ...overrides,
  };
}

function putRequest(body) {
  return new Request("http://localhost/api/providers/conn-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id = "conn-1") {
  return Promise.resolve({ id });
}

describe("PUT /api/providers/[id] priority ceiling (#6562 / port 6626)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists an edit when the round-tripped priority already exceeds the old 100 cap", async () => {
    const connection = makeConnection({ priority: 142 });
    getProviderConnectionById.mockResolvedValue(connection);
    updateProviderConnection.mockImplementation(async (id, data) => ({ ...connection, ...data }));

    // Mirrors the edit modal: priority is always resent unchanged.
    const response = await PUT(putRequest({ name: connection.name, priority: connection.priority }), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body?.error?.message).not.toBe("Invalid request");
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection.mock.calls[0][1].priority).toBe(142);
    expect(body.connection.priority).toBe(142);
  });

  it("still rejects a genuinely invalid priority with the stable source envelope (control)", async () => {
    // Lookup is deliberately left unconfigured: the source route validates the
    // body first, so the envelope must win before any connection lookup or DB
    // write happens.
    const response = await PUT(putRequest({ name: "Codex (imported)", priority: 500_000 }), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(400);
    // The source regression asserts only `error.message` — that is the
    // upstream contract. The `details[0].field` check below is a durindoor
    // local-envelope assertion (durindoor reproduces the nested shape by hand);
    // per-issue text is Zod-generated upstream and deliberately not asserted.
    expect(body.error.message).toBe("Invalid request");
    expect(body.error.details[0].field).toBe("priority");
    expect(getProviderConnectionById).not.toHaveBeenCalled();
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("strips transient Codex identity from provider metadata updates", async () => {
    const connection = makeConnection({
      providerSpecificData: { workspaceId: "workspace-abc", codexFingerprintMode: "session" },
    });
    getProviderConnectionById.mockResolvedValue(connection);
    updateProviderConnection.mockImplementation(async (id, data) => ({ ...connection, ...data }));

    await PUT(
      putRequest({
        providerSpecificData: {
          codexFingerprintMode: "full",
          codexClientIdentity: { sessionId: "caller-session" },
          codexOriginalIdentityHeaders: { "session-id": "caller-session" },
        },
      }),
      { params: params() },
    );

    expect(updateProviderConnection.mock.calls[0][1].providerSpecificData).toEqual({
      workspaceId: "workspace-abc",
      codexFingerprintMode: "full",
    });
  });
});
