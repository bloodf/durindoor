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
it.each([
  { accessToken: "valid", copilotTokenExpiresAt: 1e300 },
  { accessToken: "valid", expiresIn: 1e300 },
  { providerSpecificData: { copilotTokenExpiresAt: 1e300 } }
])("rejects raw malformed refresh %j", async (result) => {
  expect(await updateProviderCredentials("id", result)).toBe(false);
});
