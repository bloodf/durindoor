import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";
import { GitlabExecutor } from "../../open-sse/executors/gitlab.js";

afterEach(() => vi.unstubAllGlobals());

describe("GitLab sign-in and request isolation", () => {
  for (const provider of ["gitlab", "gitlab-duo"]) {
    it(`uses the selected instance and PKCE for ${provider} OAuth`, async () => {
      const meta = { baseUrl: "https://gitlab.example.com", clientId: "fake-client" };
      const auth = await generateAuthData(provider, "http://localhost/callback", meta);
      const url = new URL(auth.authUrl);
      expect(url.origin).toBe(meta.baseUrl);
      expect(url.pathname).toBe("/oauth/authorize");
      expect(url.searchParams.get("code_challenge")).toBe(auth.codeChallenge);
      expect(url.searchParams.get("state")).toBe(auth.state);
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(Response.json({ access_token: "fake-access", refresh_token: "fake-refresh" }))
        .mockResolvedValueOnce(Response.json({ username: "fake-user" }));
      vi.stubGlobal("fetch", fetchMock);
      const tokens = await exchangeTokens(provider, "fake-code", auth.redirectUri, auth.codeVerifier, auth.state, meta);
      expect(fetchMock.mock.calls[0][0]).toBe(`${meta.baseUrl}/oauth/token`);
      expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("code_verifier")).toBe(auth.codeVerifier);
      expect(fetchMock.mock.calls[1][0]).toBe(`${meta.baseUrl}/api/v4/user`);
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fake-access");
      expect(tokens.providerSpecificData).toMatchObject({ baseUrl: meta.baseUrl, clientId: meta.clientId, authKind: "oauth" });
    });
  }

  it("uses only the selected Duo connection credentials for each request", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ choices: [{ text: "answer" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const executor = new GitlabExecutor();
    for (const [host, token, stream] of [["one.example.com", "fake-one", false], ["two.example.com", "fake-two", true]]) {
      const result = await executor.execute({ model: "fake-model", body: { messages: [{ role: "user", content: "hello" }] }, stream,
        credentials: { accessToken: token, providerSpecificData: { baseUrl: `https://${host}` } } });
      const [url, init] = fetchMock.mock.calls.at(-1);
      expect(url).toBe(`https://${host}/api/v4/code_suggestions/completions`);
      expect(init.headers.Authorization).toBe(`Bearer ${token}`);
      const text = await result.response.text();
      expect(text).toContain("answer");
      if (stream) expect(text).toContain("data: [DONE]");
    }
  });
});
