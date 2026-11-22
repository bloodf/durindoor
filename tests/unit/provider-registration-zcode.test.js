import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { isZcodeDispatchEnabled } from "../../open-sse/executors/zcode.js";
import { isRoutableProvider } from "../../src/shared/constants/providers.js";

describe("production ZCode registration", () => {
  it("exposes registry metadata, executor aliases, and picker models without mocks", () => {
    const entry = REGISTRY.find((provider) => provider.id === "zcode");
    expect(entry).toMatchObject({ id: "zcode", alias: "zc", noAuth: true, passthroughModels: true, transport: { executor: "zcode" } });
    expect(hasSpecializedExecutor("zcode")).toBe(true);
    expect(hasSpecializedExecutor("zc")).toBe(true);
    expect(getExecutor("zcode")).toBe(getExecutor("zc"));
    expect(isRoutableProvider("zcode")).toBe(true);
    expect(PROVIDER_MODELS.zc.map(({ id }) => id)).toEqual(["glm-5.3", "glm-5.2"]);
  });

  it("keeps dispatch off except for the exact boolean opt-in", () => {
    expect(isZcodeDispatchEnabled({})).toBe(false);
    expect(isZcodeDispatchEnabled({ providerSpecificData: { enableSessionDispatch: "true" } })).toBe(false);
    expect(isZcodeDispatchEnabled({ providerSpecificData: { enableSessionDispatch: true } })).toBe(true);
  });
});
