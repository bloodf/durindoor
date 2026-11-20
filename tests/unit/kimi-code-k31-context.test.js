import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import coding from "../../open-sse/providers/registry/kimi-coding.js";
import codingKey from "../../open-sse/providers/registry/kimi-coding-apikey.js";

describe("Kimi Code K3.1", () => {
  it.each(["k3.1-pro", "k3.1-pro-highspeed"])("advertises %s with its context limit", id => {
    for (const provider of [coding, codingKey]) {
      expect(provider.models.find(model => model.id === id)?.contextLength).toBe(1048576);
      expect(getCapabilitiesForModel(provider.id, id)).toMatchObject({ contextWindow: 1048576, reasoning: true });
    }
  });
});
