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
import { validatedRefreshUpdates } from "../../src/shared/services/providerCredentials.js";
it.each([false, true])("rejects excessive refresh lifetime with commit guard=%s", async (guarded) => {
  const result = { accessToken: "at2", expiresIn: 10 * 365 * 24 * 3600 };
  expect(() => validatedRefreshUpdates({}, result)).toThrow();
  expect(await updateProviderCredentials("id", result, guarded ? {
    presentedRefreshToken: "rt", presentedAccessToken: "at-old"
  } : {})).toBe(false);
  expect(state.row.accessToken).toBe("at-old");
});
