import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connections: vi.fn(), resolveKiroModels: vi.fn() }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.connections,
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ disabledFreeProviders: [], hidePaidModels: false })),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));
vi.mock("open-sse/services/catalogs/kiroModels.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveKiroModels: mocks.resolveKiroModels,
}));

import { LIVE_CATALOG_WAIT_MS, withCatalogDeadline } from "../../src/shared/models/catalogDeadline.js";
import { buildModelsList } from "../../src/shared/models/buildModelsList.js";

const connection = (accessToken) => ({
  id: "kiro-1", provider: "kiro", isActive: true, accessToken, providerSpecificData: {},
});
const LIVE_ID = "live-only-model-5100";
const listsLiveModel = (models) => models.some((model) => model.id.endsWith(LIVE_ID));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe("live catalog wait is bounded (decolua/9router#5100)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("answers /v1/models while a provider catalog is still resolving, then lists it", async () => {
    const slow = deferred();
    mocks.connections.mockResolvedValue([connection("token-slow")]);
    mocks.resolveKiroModels.mockReturnValue(slow.promise);

    const first = buildModelsList(["llm"]);
    await vi.advanceTimersByTimeAsync(LIVE_CATALOG_WAIT_MS);
    expect(listsLiveModel(await first)).toBe(false);

    slow.resolve({ models: [{ id: LIVE_ID }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(listsLiveModel(await buildModelsList(["llm"]))).toBe(true);
    expect(mocks.resolveKiroModels).toHaveBeenCalledTimes(2);
  });

  it("does not start a second lookup while one is running", async () => {
    const load = vi.fn(() => new Promise(() => {}));
    const calls = [withCatalogDeadline(["dedupe"], load, 100), withCatalogDeadline(["dedupe"], load, 100)];
    await vi.advanceTimersByTimeAsync(100);
    expect(await Promise.all(calls)).toEqual([null, null]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves the last good catalog while a refresh is slow, only to the same identity", async () => {
    await withCatalogDeadline(["account-a"], async () => ({ models: ["a"] }), 100);
    const hang = () => new Promise(() => {});
    const same = withCatalogDeadline(["account-a"], hang, 100);
    const other = withCatalogDeadline(["account-b"], hang, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await same).toEqual({ models: ["a"] });
    expect(await other).toBeNull();
  });

  it.each([
    ["an empty result", async () => null],
    ["a failure", async () => { throw new Error("revoked"); }],
  ])("forgets the last good catalog after %s", async (_name, bad) => {
    const identity = ["forget", _name];
    await withCatalogDeadline(identity, async () => ({ models: ["old"] }), 100);
    await withCatalogDeadline(identity, bad, 100).catch(() => {});
    const pending = withCatalogDeadline(identity, () => new Promise(() => {}), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
  });

  it("retries a lookup that never settles", async () => {
    const load = vi.fn(() => new Promise(() => {}));
    const first = withCatalogDeadline(["stuck"], load, 100);
    await vi.advanceTimersByTimeAsync(100);
    await first;
    await vi.advanceTimersByTimeAsync(60_000);
    const second = withCatalogDeadline(["stuck"], load, 100);
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(load).toHaveBeenCalledTimes(2);
  });
});
