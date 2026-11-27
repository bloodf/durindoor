import { expect, it, vi } from "vitest";

const { refreshCredentials } = vi.hoisted(() => ({ refreshCredentials: vi.fn(async () => ({ accessToken: "new-token" })) }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ refreshCredentials }) }));
const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
const options = { updateProviderConnectionImpl: async (_id, patch) => ({ ...patch }), log: { info() {}, warn() {}, error() {}, debug() {} } };

it("deduplicates concurrent callers across the lazy executor import", async () => {
 refreshCredentials.mockClear();
 const conn = { id: "f2311c-shared", provider: "github", accessToken: "old", refreshToken: "refresh" };
 const results = await Promise.all([refreshAndUpdateCredentials(conn, true, null, options), refreshAndUpdateCredentials(conn, true, null, options)]);
 expect(refreshCredentials).toHaveBeenCalledTimes(1);
 expect(results[0]).toEqual(results[1]);
});

it("does not dispatch when aborted during the lazy import", async () => {
 refreshCredentials.mockClear();
 const controller = new AbortController();
 const pending = refreshAndUpdateCredentials({ id: "f2311c-aborted", provider: "github", refreshToken: "refresh" }, true, null, { ...options, signal: controller.signal });
 controller.abort();
 await expect(pending).rejects.toThrow();
 expect(refreshCredentials).not.toHaveBeenCalled();
});
