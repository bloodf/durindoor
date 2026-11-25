import { describe, expect, it, vi } from "vitest";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { isRoutableProvider } from "../../src/shared/constants/providers.js";

// Dispatch remains denied by production unless each connection explicitly opts in.
describe.each(["zcode", "zc"])("ZCode dispatch guard (%s)", (provider) => {
  it("is registered and routable", () => {
    expect(resolveProviderAlias(provider)).toBe("zcode");
    expect(isRoutableProvider(provider)).toBe(true);
    expect(getProviderModels(provider).map(({ id }) => id)).toEqual(["glm-5.3", "glm-5.2"]);
    expect(hasSpecializedExecutor(provider)).toBe(true);
  });

  it("rejects dispatch before transport setup without exact boolean opt-in", async () => {
    const executor = getExecutor(provider);
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    const result = await executor.execute({ model: "glm-5.3", body: {}, stream: false, credentials: { providerSpecificData: { enableSessionDispatch: "true" } } });
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({ error: { code: "zcode_dispatch_disabled" } });
    expect(buildHeaders).not.toHaveBeenCalled();
  });
});
