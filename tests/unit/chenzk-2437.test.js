/**
 * #2437 Chenzk API provider registry wiring.
 *
 * Asserts the generated registry resolves `chenzk` with the expected endpoint,
 * OpenAI format, bearer auth, category and aliases — i.e. that dropping the
 * file in and regenerating the index actually wires the provider.
 */
import { describe, it, expect } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("chenzk registry (#2437)", () => {
  const entry = REGISTRY.find((p) => p.id === "chenzk");

  it("is present in the generated registry", () => {
    expect(entry, "chenzk missing from registry/index.js").toBeTruthy();
  });

  it("targets chenzk.top OpenAI chat completions", () => {
    expect(entry.transport.baseUrl).toBe("https://chenzk.top/v1/chat/completions");
    expect(entry.transport.format).toBe("openai");
    expect(entry.transport.validateUrl).toBe("https://chenzk.top/v1/models");
  });

  it("uses bearer auth and apikey category", () => {
    expect(entry.category).toBe("apikey");
    expect(entry.transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("declares aliases and a non-empty model list", () => {
    expect(entry.aliases).toEqual(expect.arrayContaining(["chenzk-api", "ezkielyna"]));
    expect(entry.models.length).toBeGreaterThan(0);
  });
});
