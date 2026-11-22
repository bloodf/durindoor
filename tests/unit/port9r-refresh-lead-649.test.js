import { describe, expect, it } from "vitest";
import { getRefreshLeadMs } from "../../open-sse/services/tokenRefresh.js";
import { shouldRefreshCredentials } from "../../open-sse/services/oauthCredentialManager.js";
import { selectConnectionsNeedingRefresh } from "../../src/sse/services/backgroundTokenRefresh.js";

describe("per-connection OAuth refresh lead", () => {
  it("applies the override to request and background selection", () => {
    const now = Date.now();
    const conn = { provider: "github", authType: "oauth", refreshToken: "token", expiresAt: new Date(now + 45 * 60_000).toISOString(), providerSpecificData: { refreshLeadMs: 60 * 60_000 } };
    expect(shouldRefreshCredentials(conn.provider, conn, now)).toBe(true);
    expect(selectConnectionsNeedingRefresh([conn], now)).toEqual([conn]);
    expect(shouldRefreshCredentials(conn.provider, { ...conn, providerSpecificData: {} }, now)).toBe(false);
    expect(selectConnectionsNeedingRefresh([{ ...conn, providerSpecificData: {} }], now)).toEqual([]);
  });
  it.each([0, -1, Infinity, "60000", null])("ignores invalid lead %s", (refreshLeadMs) => {
    expect(getRefreshLeadMs("github", { refreshLeadMs })).toBe(getRefreshLeadMs("github"));
  });
});
