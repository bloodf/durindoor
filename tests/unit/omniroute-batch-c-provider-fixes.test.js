// PR #45 review fixes for OmniRoute simple-provider batch C.
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveHerokuBaseUrl } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("hackclub: requires saved credentials", () => {
  it("is not noAuth and requires an apikey (Hack Club requires a Bearer key)", () => {
    expect(PROVIDERS.hackclub.noAuth).not.toBe(true);
    const entry = REGISTRY.find((p) => p.id === "hackclub");
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.transport.noAuth).toBeUndefined();
  });
});

describe("heroku: connection testing + custom inference URL", () => {
  it("exposes a validateUrl for the connection-test probe", () => {
    expect(PROVIDERS.heroku.validateUrl).toBe("https://us.inference.heroku.com/v1/models");
  });

  it("resolveHerokuBaseUrl defaults to the standard Heroku region host", () => {
    expect(resolveHerokuBaseUrl({})).toBe("https://us.inference.heroku.com/v1");
  });

  it("resolveHerokuBaseUrl honors a user-supplied INFERENCE_URL", () => {
    const custom = "https://eu.inference.heroku.com/v1";
    expect(resolveHerokuBaseUrl({ providerSpecificData: { inferenceUrl: custom } })).toBe(custom);
    expect(resolveHerokuBaseUrl({ providerSpecificData: { baseUrl: custom } })).toBe(custom);
  });

  it("resolveHerokuBaseUrl strips a full endpoint suffix from the supplied URL", () => {
    expect(
      resolveHerokuBaseUrl({ providerSpecificData: { inferenceUrl: "https://eu.inference.heroku.com/v1/chat/completions" } })
    ).toBe("https://eu.inference.heroku.com/v1");
    expect(
      resolveHerokuBaseUrl({ providerSpecificData: { inferenceUrl: "https://eu.inference.heroku.com/v1/models/" } })
    ).toBe("https://eu.inference.heroku.com/v1");
  });

  it("DefaultExecutor.buildUrl routes chat requests through the resolved (possibly custom) base", () => {
    const executor = new DefaultExecutor("heroku");
    expect(executor.buildUrl("claude-opus-4-7", true, 0, null)).toBe(
      "https://us.inference.heroku.com/v1/chat/completions"
    );
    expect(
      executor.buildUrl("claude-opus-4-7", true, 0, {
        providerSpecificData: { inferenceUrl: "https://eu.inference.heroku.com/v1" },
      })
    ).toBe("https://eu.inference.heroku.com/v1/chat/completions");
  });
});

describe("haiper: video/image never exposed as chat LLM models", () => {
  it("has no chat/LLM models in the registry", () => {
    expect(getProviderModels("hp")).toEqual([]);
  });

  it("serviceKinds excludes llm and hides image/video until adapters exist", () => {
    expect(PROVIDERS.haiper.serviceKinds ?? []).not.toContain("llm");
  });
});

describe("inclusionai: discontinued endpoint removed", () => {
  it("is no longer exposed by the registry", () => {
    expect(REGISTRY.find((p) => p.id === "inclusionai")).toBeUndefined();
    expect(PROVIDERS.inclusionai).toBeUndefined();
  });
});

describe("kluster: discontinued endpoint removed", () => {
  it("is no longer exposed by the registry", () => {
    expect(REGISTRY.find((p) => p.id === "kluster")).toBeUndefined();
    expect(PROVIDERS.kluster).toBeUndefined();
  });
});
