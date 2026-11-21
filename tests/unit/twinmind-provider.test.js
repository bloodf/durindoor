import { describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const entry = (await import("../../open-sse/providers/private/twinmind.js")).default;
  return { ...actual, default: [...actual.default, entry] };
});

import entry from "../../open-sse/providers/private/twinmind.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("staged TwinMind provider contract", () => {
  it("composes the API-key provider and identifies its app-specific executor contract", () => {
    expect(REGISTRY).toContainEqual(entry);
    expect(entry).toMatchObject({ id: "twinmind", alias: "tm", authType: "apikey" });
    expect(entry.transport).toMatchObject({ baseUrl: "https://api2.twinmind.com/api/v3", executor: "twinmind" });
  });
});
