import { describe, expect, it, vi } from "vitest";


import entry from "../../open-sse/providers/registry/twinmind.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("staged TwinMind provider contract", () => {
  it("composes the API-key provider and identifies its app-specific executor contract", () => {
    expect(REGISTRY).toContainEqual(entry);
    expect(entry).toMatchObject({ id: "twinmind", alias: "twinmind", authType: "apikey" });
    expect(entry.transport).toMatchObject({ baseUrl: "https://api2.twinmind.com/api/v3", executor: "twinmind" });
  });
});
