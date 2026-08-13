import { describe, expect, it } from "vitest";

import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";

const CONFIG = { id: "searxng", baseUrl: "https://search.example.com" };
const override = (baseUrl) => ({ providerOptions: { baseUrl } });

describe("resolveBaseUrl SSRF guard", () => {
  it.each([
    ["non-http scheme", "file:///etc/passwd"],
    ["loopback", "http://127.0.0.1:8080"],
    ["link-local", "http://169.254.42.42/latest/meta-data"],
    ["RFC1918 10/8", "http://10.0.0.1"],
    ["RFC1918 172.16/12", "http://172.31.255.254"],
    ["RFC1918 192.168/16", "http://192.168.1.1"],
  ])("rejects %s overrides", (_class, baseUrl) => {
    expect(() => resolveBaseUrl(CONFIG, override(baseUrl))).toThrow();
  });

  it("accepts a public HTTPS override", () => {
    expect(resolveBaseUrl(CONFIG, override("https://search.example.net/api/"))).toBe("https://search.example.net/api");
  });
});
