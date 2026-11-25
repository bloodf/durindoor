import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), local: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.create }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ findAndReadCursorLocalAuth: mocks.local }));

import { POST } from "../../src/app/api/oauth/cursor/import/route.js";

describe("Cursor imports without a supported sign-in contract", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("keeps supplied accounts independent and never exchanges or refreshes their tokens", async () => {
    const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outbound disabled"));
    mocks.create.mockImplementation(async (connection) => ({ ...connection, id: connection.email }));
    const accounts = ["first", "second"].map((name, index) => ({
      accessToken: `${name}-${"x".repeat(50)}`,
      machineId: String(index + 1).repeat(32),
      cachedEmail: `${name}@example.invalid`,
    }));
    for (const account of accounts) {
      const response = await POST(new Request("http://localhost/api/oauth/cursor/import", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(account),
      }));
      expect(response.status).toBe(200);
    }
    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const [index, account] of accounts.entries()) {
      expect(mocks.create.mock.calls[index][0]).toMatchObject({
        accessToken: account.accessToken, refreshToken: null, email: account.cachedEmail,
        providerSpecificData: { machineId: account.machineId, authMethod: "imported" },
      });
    }
    expect(mocks.local).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });
});
