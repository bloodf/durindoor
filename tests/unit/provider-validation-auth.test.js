import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { buildGenericProviderValidationHeaders } from "../../src/app/api/providers/validate/route.js";

describe("generic provider validation auth", () => {
  it("uses registry transport.auth for Pioneer x-api-key validation", () => {
    const headers = buildGenericProviderValidationHeaders(PROVIDERS.pioneer, "sk-pioneer");

    expect(headers["x-api-key"]).toBe("sk-pioneer");
    expect(headers.Authorization).toBeUndefined();
  });
});
