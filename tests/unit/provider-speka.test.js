import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseModel } from "../../open-sse/services/model.js";
import { isValidModel } from "../../src/shared/constants/models.js";

const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

describe("Speka registry consumers", () => {
  afterEach(() => vi.clearAllMocks());

  it("routes namespaced model IDs without dropping their publisher", () => {
    expect(parseModel("speka/vendor/future-chat")).toMatchObject({ provider: "speka", model: "vendor/future-chat" });
    expect(isValidModel("speka", "vendor/future-chat")).toBe(true);
    const executor = new DefaultExecutor("speka");
    expect(executor.buildUrl("vendor/future-chat", false)).toBe("https://speka.me/v1/chat/completions");
    expect(executor.buildHeaders({ apiKey: "test-only" }, false).Authorization).toBe("Bearer test-only");
    expect(executor.buildHeaders({}, false).Authorization).toBeUndefined();
  });

  it("discovers models through the real registry fallback with Bearer auth", async () => {
    routedFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "vendor/future-chat" }] }) });
    const result = await fetchConnectionModels({ id: "speka-test", provider: "speka", apiKey: "test-only" });
    expect(result).toMatchObject({ provider: "speka", connectionId: "speka-test", models: [{ id: "vendor/future-chat" }] });
    expect(routedFetch).toHaveBeenCalledWith("https://speka.me/v1/models", expect.objectContaining({
      method: "GET", headers: expect.objectContaining({ Authorization: "Bearer test-only" }),
    }), expect.anything());
  });

  it("propagates discovery failures instead of presenting a successful empty catalog", async () => {
    routedFetch.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    expect(await fetchConnectionModels({ id: "speka-test", provider: "speka", apiKey: "test-only" }))
      .toEqual({ error: "Failed to fetch models: 429", status: 429 });
  });
});
