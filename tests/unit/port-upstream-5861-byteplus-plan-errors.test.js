import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/providers/validate/route.js";

const validate = async () => (await POST(new Request("http://localhost/api/providers/validate", {
  method: "POST", body: JSON.stringify({ provider: "byteplus", apiKey: "synthetic-byteplus-key" }),
}))).json();
const answer = (status, code) => vi.mocked(fetch).mockImplementation(async () =>
  new Response(JSON.stringify({ error: { code, message: "synthetic upstream message" } }), { status }));

describe("upstream #5861: BytePlus plan errors keep the key valid", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    [403, "AccessDenied"],
    [400, "InvalidSubscription"],
    [404, "ModelNotOpen"],
  ])("accepts the key on %i %s", async (status, code) => {
    answer(status, code);
    expect(await validate()).toMatchObject({ valid: true });
  });

  it.each([
    [401, "Unauthorized"],
    [403, "AuthenticationError"],
    [403, "InvalidApiKey"],
  ])("rejects the key on %i %s", async (status, code) => {
    answer(status, code);
    expect(await validate()).toMatchObject({ valid: false });
  });
});
