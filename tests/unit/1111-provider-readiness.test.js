import { describe, expect, it } from "vitest";
import { providerReadiness } from "../../src/shared/services/providerReadiness.js";

describe("provider readiness from local evidence", () => {
  it("separates catalog and configured chat dispatch from live evidence", () => {
    const result = providerReadiness("openai");
    expect(result.catalog).toBe("LISTED");
    expect(result.chatDispatch).toBe("CONFIGURED");
    expect(result.nativeKinds).toContain("chat");
    expect(result.authentication.status).toBe("UNKNOWN");
    expect(result.inference.status).toBe("UNKNOWN");
  });

  it("does not treat blocked or unknown providers as dispatchable", () => {
    expect(providerReadiness("devin").chatDispatch).toBe("UNSUPPORTED");
    expect(providerReadiness("missing-provider")).toMatchObject({ catalog: "NOT_LISTED", chatDispatch: "UNKNOWN", nativeKinds: [] });
  });

  it("reports only configured native kinds, including websocket routes", () => {
    expect(providerReadiness("gemini").nativeKinds).toContain("live");
    expect(providerReadiness("codex").nativeKinds).toEqual([]);
  });
});
