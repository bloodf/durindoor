import { describe, expect, it } from "vitest";
import { redactHeaders, redactValue } from "../../src/lib/observability/redact.js";

describe("timeline redaction", () => {
  it("replaces authorization value and keeps the key", () => {
    expect(redactHeaders({ Authorization: "Bearer secret", Accept: "text/event-stream" }, { keepKeys: true }))
      .toEqual({ Authorization: "[redacted]", Accept: "text/event-stream" });
  });
  it("redacts numeric token-count headers", () => {
    expect(redactHeaders({ "x-token-count": 3, Accept: "text/event-stream" }, { keepKeys: true }))
      .toEqual({ "x-token-count": "[redacted]", Accept: "text/event-stream" });
  });

  it("deletes authorization when keepKeys is false", () => {
    expect(redactHeaders({ Authorization: "Bearer secret", Accept: "text/event-stream" }, { keepKeys: false }))
      .toEqual({ Accept: "text/event-stream" });
  });

  it("treats Proxy-Authorization as sensitive in headers and object bodies", () => {
    expect(redactHeaders({ "Proxy-Authorization": "Basic abc", Accept: "text/event-stream" }))
      .toEqual({ "Proxy-Authorization": "[redacted]", Accept: "text/event-stream" });
    const out = redactValue({ "Proxy-Authorization": "Basic abc", other: "ok" });
    expect(out["Proxy-Authorization"]).toBe("[redacted]");
    expect(out.other).toBe("ok");
  });
  it("redacts sk- body tokens and api-key fields", () => {
    const out = redactValue({
      apiKey: "sk-abcdefgh",
      text: "token sk-abcdefgh and AIzaXXXX",
      nested: { "x-api-key": "abc" },
    });
    expect(JSON.stringify(out)).not.toMatch(/sk-abcdefgh|AIzaXXXX|abc/);
    expect(out.apiKey).toBe("[redacted]");
    expect(out.nested["x-api-key"]).toBe("[redacted]");
  });

  it("strips credential query parameters", () => {
    const out = redactValue("https://example.com/v1?key=secret&q=ok");
    expect(out).not.toContain("secret");
    expect(out).toContain("q=ok");
  });

  it("leaves query params that merely contain 'key' as a substring unchanged", () => {
    const out = redactValue("https://example.com/v1?monkey=banana&q=ok");
    expect(out).toBe("https://example.com/v1?monkey=banana&q=ok");
  });

  it("redacts credentials in every URL query string", () => {
    const out = redactValue("https://one.example/?key=first https://two.example/?token=second");
    expect(out).not.toContain("first");
    expect(out).not.toContain("second");
  });

  it("redacts plural credential query params such as access_tokens", () => {
    const out = redactValue("https://example.com/v1?access_tokens=secret&q=ok");
    expect(out).not.toContain("secret");
    expect(out).toContain("q=ok");
  });

  it("redacts query params whose normalized name ends with authorization", () => {
    const out = redactValue("https://example.com/v1?proxy_authorization=secret&q=ok");
    expect(out).not.toContain("secret");
    expect(out).toContain("q=ok");
  });
  it("leaves prose with question marks unchanged", () => {
    expect(redactValue("Is this right?really")).toBe("Is this right?really");
  });

  it("redacts singular and plural credential keys while keeping numeric token counters", () => {
    const out = redactValue({
      accessToken: "s",
      accessTokens: ["a", "b"],
      refreshTokens: ["c"],
      maxTokens: 16,
      totalTokens: 7,
      reasoningTokens: 9,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 5,
      promptTokenCount: 12,
      candidatesTokenCount: 13,
      totalTokenCount: 14,
      thoughtsTokenCount: 15,
      cachedContentTokenCount: 16,
    });
    expect(out.accessToken).toBe("[redacted]");
    expect(out.accessTokens).toBe("[redacted]");
    expect(out.refreshTokens).toBe("[redacted]");
    expect(out.maxTokens).toBe(16);
    expect(out.totalTokens).toBe(7);
    expect(out.reasoningTokens).toBe(9);
    expect(out.cache_read_input_tokens).toBe(4);
    expect(out.cache_creation_input_tokens).toBe(5);
    expect(out.promptTokenCount).toBe(12);
    expect(out.candidatesTokenCount).toBe(13);
    expect(out.totalTokenCount).toBe(14);
    expect(out.thoughtsTokenCount).toBe(15);
    expect(out.cachedContentTokenCount).toBe(16);
  });

  it("keeps unknown numeric token counters but still redacts numeric credential fields", () => {
    const out = redactValue({ accepted_prediction_tokens: 3, apiKey: 5 });
    expect(out.accepted_prediction_tokens).toBe(3);
    expect(out.apiKey).toBe("[redacted]");
  });
  it("keeps duplicated non-circular references", () => {
    const shared = { keep: "value" };
    expect(redactValue({ a: shared, b: shared })).toEqual({ a: shared, b: shared });
  });

  it("redacts camelCase apiKey with a plain non-prefixed value", () => {
    const out = redactValue({ apiKey: "plain-secret", keep: "ok" });
    expect(out.apiKey).toBe("[redacted]");
    expect(out.keep).toBe("ok");
  });

  it("matches apiKey forms under - and _ separators", () => {
    const out = redactValue({
      "x-api-key": "abc",
      x_api_key: "def",
      xApiKey: "ghi",
      xapikey: "jkl",
    });
    expect(out["x-api-key"]).toBe("[redacted]");
    expect(out.x_api_key).toBe("[redacted]");
    expect(out.xApiKey).toBe("[redacted]");
    expect(out.xapikey).toBe("[redacted]");
  });

  it("redacts URL-encoded query parameter names and values", () => {
    const encodedName = redactValue("https://example.com/v1?api%2Dkey=secret&q=ok");
    expect(encodedName).not.toContain("secret");
    expect(encodedName).toContain("q=ok");

    const encodedValue = redactValue("https://example.com/v1?q=sk%2Dabcdefgh&keep=ok");
    expect(encodedValue).not.toMatch(/%2Dabcdefgh/i);
    expect(encodedValue).toContain("keep=ok");
    expect(decodeURIComponent(encodedValue)).not.toMatch(/sk[-_]abcdefgh/i);
    expect(decodeURIComponent(encodedValue)).toContain("keep=ok");
  });



  it("replaces circular references and still redacts sibling secrets", () => {
    const obj = { apiKey: "plain-secret", other: "keep" };
    obj.self = obj;
    let out;
    expect(() => { out = redactValue(obj); }).not.toThrow();
    expect(out.apiKey).toBe("[redacted]");
    expect(out.other).toBe("keep");
    expect(out.self).toBe("[circular]");
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("replaces self-referential arrays", () => {
    const value = ["keep"];
    value.push(value);
    expect(redactValue(value)).toEqual(["keep", "[circular]"]);
  });
  it("preserves repeated query params while redacting credentials", () => {
    expect(redactValue("https://ex.com/v1?tag=x&tag=y&key=secret"))
      .toBe("https://ex.com/v1?tag=x&tag=y&key=%5Bredacted%5D");
  });

  it("redacts every repeated credential query param", () => {
    expect(redactValue("https://ex.com/v1?token=a&token=b&q=ok"))
      .toBe("https://ex.com/v1?token=%5Bredacted%5D&token=%5Bredacted%5D&q=ok");
  });

  it("redacts session-cookie headers", () => {
    expect(redactHeaders({ "x-session-cookie": "abc" }, { keepKeys: true }))
      .toEqual({ "x-session-cookie": "[redacted]" });
  });

  it("redacts authorization substrings in object keys", () => {
    expect(redactValue({ authorizations: "abc" })).toEqual({ authorizations: "[redacted]" });
  });
});
