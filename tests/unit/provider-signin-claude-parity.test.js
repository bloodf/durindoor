// MIT sources: router-for-me/CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864
// internal/auth/claude/anthropic_auth.go; cheaper-inference/OmniRoute
// b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 src/lib/oauth/providers/claude.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()), proxyAwareFetch: vi.fn(),
}));

import { exchangeTokens, generateAuthData, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { refreshClaudeOAuthToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import claudeRegistry from "../../open-sse/providers/registry/claude.js";
import { parseClaudeAuthorizationCode } from "../../src/lib/oauth/providerParity/claude/exchange.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { __clearRefreshDedupCacheForTesting(); proxyAwareFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Claude sign-in and requests over mocked transports", () => {
  it("binds two independent authorization requests and asks for fresh login", async () => {
    const [a, b] = await Promise.all([generateAuthData("claude", "https://example.test/callback"), generateAuthData("claude", "https://example.test/callback")]);
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    const url = new URL(a.authUrl);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ prompt: "login", code: "true", state: a.state, code_challenge: a.codeChallenge, code_challenge_method: "S256", redirect_uri: "https://example.test/callback" });
    expect(url.searchParams.get("scope").split(" ")).toEqual(expect.arrayContaining(["user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers"]));
  });

  it("keeps two web exchanges and profile lookups on their own credentials and proxies", async () => {
    const fetch = vi.fn(async (url, init) => {
      if (init.method === "POST") {
        const code = JSON.parse(init.body).code;
        return json({ access_token: `access-${code}`, refresh_token: `refresh-${code}`, account: { email_address: `${code}@example.test` } });
      }
      const token = init.headers.Authorization.slice(7);
      return json({ account: { uuid: token, email: `${token}@example.test` }, organization: { uuid: `org-${token}` } });
    });
    vi.stubGlobal("fetch", fetch);
    const proxies = [{ proxyUrl: "http://proxy-a.test" }, { proxyUrl: "http://proxy-b.test" }];
    const result = await Promise.all(proxies.map((proxy, i) => exchangeTokens("claude", `code-${i}#state-${i}`, "redirect", `verifier-${i}`, `state-${i}`, {}, proxy)));
    result.forEach((value, i) => {
      expect(value).toMatchObject({ accessToken: `access-code-${i}`, refreshToken: `refresh-code-${i}`, email: `access-code-${i}@example.test`, providerSpecificData: { claudeAccountUuid: `access-code-${i}`, claudeOrgUuid: `org-access-code-${i}` } });
      expect(fetch.mock.calls.filter(([, init]) => init.proxyOptions === proxies[i])).toHaveLength(2);
      const post = fetch.mock.calls.find(([, init]) => init.method === "POST" && init.proxyOptions === proxies[i])[1];
      expect(JSON.parse(post.body)).toMatchObject({ code: `code-${i}`, state: `state-${i}`, code_verifier: `verifier-${i}`, redirect_uri: "redirect", grant_type: "authorization_code" });
    });
  });

  it("refreshes independent families once and classifies rejected grants", async () => {
    proxyAwareFetch.mockImplementation(async (_url, init) => {
      const token = JSON.parse(init.body).refresh_token;
      return token === "dead" ? json({ error: "invalid_grant" }, 400) : json({ access_token: `new-${token}`, expires_in: 3600 });
    });
    const [a, duplicate, b, rejected] = await Promise.all([refreshClaudeOAuthToken("a"), refreshClaudeOAuthToken("a"), refreshClaudeOAuthToken("b"), refreshClaudeOAuthToken("dead")]);
    expect(a).toEqual({ accessToken: "new-a", refreshToken: "a", expiresIn: 3600 });
    expect(duplicate).toEqual(a);
    expect(b.refreshToken).toBe("b");
    expect(rejected).toMatchObject({ error: "unrecoverable_refresh_error", code: "invalid_grant" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(proxyAwareFetch.mock.calls[0][1].headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  });

  it("rejects the unsupported device grant without network", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestDeviceCode("claude", "challenge")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exposes the curated Claude model inventory without discovery traffic", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(claudeRegistry.models.map((model) => model.id)).toContain("claude-sonnet-4-6");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses Claude OAuth request headers and translates request and stream events", () => {
    const executor = new DefaultExecutor("claude");
    expect(executor.buildUrl("claude-sonnet-4-6", true)).toContain("/v1/messages?beta=true");
    const headers = executor.buildHeaders({ accessToken: "synthetic-token", authType: "oauth" }, true);
    expect(headers.Authorization).toBe("Bearer synthetic-token");
    expect(headers["Anthropic-Beta"]).toContain("oauth-2025-04-20");
    expect(headers["anthropic-version"] || headers["Anthropic-Version"]).toBeTruthy();
    const request = openaiToClaudeRequest("claude-sonnet-4-6", { messages: [{ role: "user", content: "hello" }], max_tokens: 42 }, true);
    expect(request.messages[0].content).toBeTruthy();
    const state = {};
    claudeToOpenAIResponse({ type: "message_start", message: { id: "msg-1", model: "claude-sonnet-4-6", usage: { input_tokens: 2 } } }, state);
    const chunk = claudeToOpenAIResponse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }, state);
    expect(JSON.stringify(chunk)).toContain("hello");
  });
});

// Staging-only: remove this assertion once the shared provider entry adopts the helper.
describe("staged web registration", () => {
  it("rejects a pasted state that differs from the bound flow", () => {
    expect(() => parseClaudeAuthorizationCode("code#other", "state")).toThrow();
  });
});
