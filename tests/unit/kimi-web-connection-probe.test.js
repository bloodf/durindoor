import { describe, it, expect } from "vitest";
import { buildRegistryProviderProbe } from "../../src/app/api/providers/providerProbe.js";

describe("kimi-web connection probe", () => {
  it("builds a non-null OpenAI-style probe that extracts the kimi-auth JWT", () => {
    const jwt = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ1c2VyIn0.signature";
    const cookieBlob = `_ga=1; theme=dark; kimi-auth=${jwt}; __cf_bm=ignored`;

    const probe = buildRegistryProviderProbe("kimi-web", cookieBlob);

    expect(probe).not.toBeNull();
    expect(probe.url).toBe(
      "https://www.kimi.com/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels"
    );
    expect(probe.options.method).toBe("POST");
    expect(probe.options.headers.Authorization).toBe(`Bearer ${jwt}`);
    expect(probe.options.headers.Cookie).toBe(`kimi-auth=${jwt}`);
    expect(probe.options.headers["connect-protocol-version"]).toBe("1");
    expect(probe.options.body).toBe("{}");
    expect(probe.accepts).toBe("ok");
  });

  it("returns null when the cookie blob contains no kimi-auth JWT", () => {
    const probe = buildRegistryProviderProbe("kimi-web", "_ga=1; theme=dark");
    expect(probe).toBeNull();
  });
});
