import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const callback = "http://localhost:20128/callback";
const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1XzEifQ.sig";

afterEach(() => vi.unstubAllGlobals());

describe.each(["cline", "clinepass"])("%s sign-in", (provider) => {
  it("preserves state and accepts a percent-encoded embedded token callback without a network exchange", async () => {
    const fetchMock = vi.fn(() => { throw new Error("unexpected outbound request"); });
    vi.stubGlobal("fetch", fetchMock);
    const auth = await generateAuthData(provider, callback);
    const url = new URL(auth.authUrl);
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(url.searchParams.get("callback_url")).toBe(callback);
    const payload = Buffer.from(JSON.stringify({ accessToken: jwt, refreshToken: `${provider}-refresh`, email: `${provider}@example.test` })).toString("base64");
    const encoded = [...payload].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
    const result = await exchangeTokens(provider, encoded, callback, auth.codeVerifier, auth.state);
    expect(result).toMatchObject({ accessToken: jwt, refreshToken: `${provider}-refresh`, email: `${provider}@example.test` });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges an opaque code using the selected provider's token endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { accessToken: jwt, refreshToken: `${provider}-rotated` } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await exchangeTokens(provider, "opaque-code", callback, null, "state");
    expect(result).toMatchObject({ accessToken: jwt, refreshToken: `${provider}-rotated` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.cline.bot/api/v1/auth/token");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ code: "opaque-code", redirect_uri: callback, client_type: "extension" });
  });
});

describe("Cline request credentials", () => {
  it.each(["cline", "clinepass"])("uses the selected %s credential for each executor call", async (provider) => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "mock", choices: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const executor = new DefaultExecutor(provider);
    for (const credentials of [{ accessToken: jwt }, { apiKey: "clp_fake_direct_key" }]) {
      const model = provider === "clinepass" ? "cline-pass/glm-5.2" : "test-model";
      await executor.execute({ model, body: { model, messages: [{ role: "user", content: "hello" }] }, stream: false, credentials });
    }
    expect(calls).toHaveLength(2);
    expect(calls.map(({ init }) => init.headers.Authorization)).toEqual([`Bearer workos:${jwt}`, "Bearer clp_fake_direct_key"]);
    expect(calls.map(({ url }) => url)).toEqual(Array(2).fill("https://api.cline.bot/api/v1/chat/completions"));
    expect(JSON.parse(calls[1].init.body).model).toBe(provider === "clinepass" ? "cline-pass/glm-5.2" : "test-model");
  });
});
