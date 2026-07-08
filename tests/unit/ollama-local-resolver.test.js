import { describe, it, expect } from "vitest";
import { resolveOllamaLocalHost } from "../../open-sse/config/providers.js";

describe("resolveOllamaLocalHost", () => {
  it("defaults to localhost host without path", () => {
    expect(resolveOllamaLocalHost({})).toBe("http://localhost:11434");
  });

  it("strips /api/chat suffix from user-entered host", () => {
    expect(resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "http://mybox:11434/api/chat" } })).toBe("http://mybox:11434");
  });

  it("strips trailing slash from host-only value", () => {
    expect(resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "http://mybox:11434/" } })).toBe("http://mybox:11434");
  });

  it("keeps custom host without trailing path", () => {
    expect(resolveOllamaLocalHost({ providerSpecificData: { baseUrl: "http://ollama.local:8080" } })).toBe("http://ollama.local:8080");
  });
});
