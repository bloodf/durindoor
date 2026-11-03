// Free.ai provider (#1181). Unverified: live chat/models behaviour.
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("free-ai provider", () => {
  it("registers once with the free-ai alias", () => {
    expect(REGISTRY.filter((e) => (e.alias || e.id) === "free-ai")).toHaveLength(1);
  });

  it("posts to /v1/chat/ with the trailing slash preserved", () => {
    const url = new DefaultExecutor("free-ai").buildUrl("any-model", false, 0, { apiKey: "k" });
    expect(url).toBe("https://api.free.ai/v1/chat/");
  });

  it("discovers models from /v1/models instead of a static list", () => {
    const entry = REGISTRY.find((e) => e.id === "free-ai");
    expect(entry.models).toEqual([]);
    expect(entry.modelsFetcher.url).toBe("https://api.free.ai/v1/models");
  });
});
