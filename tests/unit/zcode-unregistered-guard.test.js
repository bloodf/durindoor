import { afterEach, describe, expect, it, vi } from "vitest";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { isRoutableProvider } from "../../src/shared/constants/providers.js";

// See internal/docs/zcode-v4-compatibility-1252.md for the pinned V4 runtime boundary.
describe.each(["zcode", "zc"])("unqualified ZCode provider (%s)", (provider) => {
  afterEach(() => vi.restoreAllMocks());

  it("does not advertise models or resolve to an existing provider", () => {
    expect(resolveProviderAlias(provider)).toBe(provider);
    expect(isRoutableProvider(provider)).toBe(false);
    expect(getProviderModels(provider)).toEqual([]);
    expect(hasSpecializedExecutor(provider)).toBe(false);
  });

  it.each([false, true])("rejects dispatch before transport setup (stream=%s)", async (stream) => {
    const executor = getExecutor(provider);
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    const model = "glm-5.3";

    await expect(executor.execute({
      model,
      body: { model, messages: [{ role: "user", content: "Hello" }] },
      stream,
      credentials: { apiKey: "synthetic-key" },
    })).rejects.toMatchObject({
      status: 400,
      message: `Unknown provider "${provider}": no supported transport endpoint`,
    });

    expect(buildHeaders).not.toHaveBeenCalled();
  });
});
