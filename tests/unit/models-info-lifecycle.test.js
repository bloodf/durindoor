import { describe, expect, it } from "vitest";

describe("GET /v1/models/info lifecycle and default effort (#1363)", () => {
  const get = async (id) => {
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");
    const res = await GET(new Request(`http://local.test/v1/models/info?id=${id}`));
    expect(res.status).toBe(200);
    return res.json();
  };

  it("exposes lifecycle on legacy and deprecated Anthropic rows", async () => {
    expect((await get("anthropic/claude-opus-4-8")).lifecycle).toBe("legacy");
    expect((await get("anthropic/claude-sonnet-4-5-20250929")).lifecycle).toBe("deprecated");
  });

  it("omits lifecycle on active models and publishes the Haiku 5.5 default effort", async () => {
    const haiku = await get("anthropic/claude-haiku-5-5");
    expect(haiku.lifecycle).toBeUndefined();
    expect(haiku.capabilities.defaultEffort).toBe("medium");
  });
});
