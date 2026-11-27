import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: { accessToken: "at-old", refreshToken: "rt" } }));
vi.mock("../../src/lib/localDb.js", () => ({
  updateProviderConnection: vi.fn(async (_id, updates, options) => {
    const applied = options?.shouldCommitConnection?.(state.row) ?? true;
    if (applied) Object.assign(state.row, updates);
    return { applied };
  })
}));
import { updateProviderCredentials } from "../../src/sse/services/tokenRefresh.js";
it("refuses an older refresh when the refresh token did not rotate", async () => {
  const options = { presentedRefreshToken: "rt", presentedAccessToken: "at-old" };
  const results = await Promise.all([
    updateProviderCredentials("id", { accessToken: "at-new" }, options),
    updateProviderCredentials("id", { accessToken: "at-stale" }, options)
  ]);
  expect(results).toEqual([true, false]);
  expect(state.row.accessToken).toBe("at-new");
});
it.each([{ refreshToken: {} }, { copilotToken: "bad\n" }, { providerSpecificData: { copilotTokenExpiresAt: -1 } }])("rejects malformed fields %j", async (fields) => {
  expect(await updateProviderCredentials("id", { accessToken: "at-valid", ...fields })).toBe(false);
});
