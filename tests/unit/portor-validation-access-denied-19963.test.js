import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/providers/validate/route.js";
import { classifyValidationRejection } from "../../src/lib/providers/validationRejection.js";

const KEY = "fal-secret-key-0123456789";
const NGINX_403 = `<html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1>${KEY}</body></html>`;

const validate = async (provider = "fal-ai") => (await POST(new Request("http://localhost/api/providers/validate", {
  method: "POST", body: JSON.stringify({ provider, apiKey: KEY }),
}))).json();

describe("OmniRoute #19963 - provider access refusal is not an invalid key", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reports a geo-block HTML 403 as access denied, without echoing the body", async () => {
    fetch.mockImplementation(async () => new Response(NGINX_403, { status: 403 }));
    const result = await validate();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/^Access denied by provider \(HTTP 403\)/);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it.each([
    ["a genuine 401", 401, JSON.stringify({ error: { message: "bad key" } })],
    ["a 403 that names the key", 403, JSON.stringify({ error: { message: "Invalid API key" } })],
    ["a bare 403", 403, ""],
  ])("keeps %s as an invalid key", async (_name, status, body) => {
    fetch.mockImplementation(async () => new Response(body, { status }));
    expect(await validate()).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("overrides an accepted verdict only on an explicit refusal", async () => {
    // The Anthropic probe accepts every status but 401.
    fetch.mockImplementation(async () => new Response("unavailable for legal reasons", { status: 451 }));
    expect(await validate("anthropic")).toMatchObject({ valid: false, error: expect.stringContaining("Access denied by provider (HTTP 451)") });

    fetch.mockImplementation(async () => new Response(NGINX_403, { status: 403 }));
    expect(await validate("anthropic")).toEqual({ valid: true, error: null });
  });

  it("classifies a region refusal on any 4xx", () => {
    expect(classifyValidationRejection(400, "User location is not supported for the API use."))
      .toEqual({ kind: "access_denied", explicit: true });
    expect(classifyValidationRejection(400, "model not found")).toEqual({ kind: "other" });
  });
});
