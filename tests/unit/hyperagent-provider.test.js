import { describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const entry = (await import("../../open-sse/providers/private/hyperagent.js")).default;
  return { ...actual, default: [...actual.default, entry] };
});

import entry from "../../open-sse/providers/private/hyperagent.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("staged HyperAgent provider contract", () => {
  it("composes its cookie-session entry and thread executor contract", () => {
    expect(REGISTRY).toContainEqual(entry);
    expect(entry).toMatchObject({ id: "hyperagent", alias: "ha", authType: "cookie" });
    expect(entry.transport).toMatchObject({ baseUrl: "https://hyperagent.com/api/threads", executor: "hyperagent" });
    expect(entry.authHint).toContain("Cookie header");
  });
});
