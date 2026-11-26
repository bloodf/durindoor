import { describe, it, expect } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";

const url = (location, model = "gemini-4-argon") =>
  getExecutor("vertex").buildUrl(model, true, 0, { accessToken: "synthetic", providerSpecificData: { projectId: "p1", location } });

describe("OmniRoute #20228: Gemini 4 Argon Vertex location", () => {
  it("moves an unsupported regional setting to global", () => {
    expect(url("us-central1")).toContain("/locations/global/");
  });

  it("keeps a location that serves Argon", () => {
    expect(url("europe-west2")).toContain("/locations/europe-west2/");
  });

  it("keeps the configured region for other models", () => {
    expect(url("us-central1", "gemini-2.5-pro")).toContain("/locations/us-central1/");
  });
});
