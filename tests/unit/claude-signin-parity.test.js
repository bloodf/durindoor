// Claude Code sign-in and request compatibility (#2034).
//
// Upstream sources compared at these pinned revisions:
//   - router-for-me/CLIProxyAPI 6faa8d20b2673404cff70a2f2d9537ae0d0e684d
//     internal/auth/claude/anthropic_auth.go — authorize scope, refresh scope
//   - cheaper-inference/OmniRoute e3c1531afd07d5e06f7ffab658584a7ae2e3627e
//     src/lib/oauth/providers/claude.ts — `prompt=login` on the authorize URL
//     src/lib/oauth/constants/oauth.ts — CLAUDE_CONFIG.scopes
//     open-sse/services/tokenRefresh/providers/claudeOAuth.ts — refresh beta
//
// Every outbound call is mocked. No provider is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { generateAuthData } from "../../src/lib/oauth/providers.js";
import {
  CLAUDE_MANUAL_REDIRECT_URI,
  defaultOAuthRedirectUri,
} from "../../src/lib/oauth/redirectUri.js";
import { refreshClaudeOAuthToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDER_OAUTH } from "../../open-sse/providers/index.js";

// The scopes both upstreams ask Anthropic for. CLIProxyAPI additionally asks
// for `user:file_upload`, which only its newer Claude Code capture needs.
const UPSTREAM_AUTHORIZE_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
];

// `org:create_api_key` is the console scope: it belongs to the authorization
// request only, never to a token refresh.
const UPSTREAM_REFRESH_SCOPE =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers";

const CLAUDE_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

describe("Claude authorization request", () => {
  it("asks Anthropic for a fresh authentication instead of reusing the stored IdP session", async () => {
    const auth = await generateAuthData("claude", CLAUDE_MANUAL_REDIRECT_URI);
    const url = new URL(auth.authUrl);

    // Anthropic's IdP reuses the browser session for this public client id.
    // A reused session invalidates the refresh-token family of the account
    // that signed in first, so a second Claude connection would silently break
    // the first one.
    expect(url.searchParams.get("prompt")).toBe("login");
  });

  it("requests every scope both upstreams grant", async () => {
    const auth = await generateAuthData("claude", CLAUDE_MANUAL_REDIRECT_URI);
    const scope = new URL(auth.authUrl).searchParams.get("scope").split(" ");

    expect(scope).toEqual(expect.arrayContaining(UPSTREAM_AUTHORIZE_SCOPES));
    // `user:sessions:claude_code` authorizes the Claude Code session the
    // runtime announces with `X-Claude-Code-Session-Id`.
    expect(scope).toContain("user:sessions:claude_code");
  });

  it("keeps the registered manual-code redirect and the PKCE parameters", async () => {
    const auth = await generateAuthData("claude", CLAUDE_MANUAL_REDIRECT_URI);
    const url = new URL(auth.authUrl);

    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(url.searchParams.get("code")).toBe("true");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(CLAUDE_MANUAL_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(auth.codeChallenge);
    expect(url.searchParams.get("state")).toBe(auth.state);
  });

  // Two Claude accounts must never share a flow: a shared verifier or state
  // would let one sign-in finish the other's authorization.
  it("gives every sign-in its own state and verifier", async () => {
    const first = await generateAuthData("claude", CLAUDE_MANUAL_REDIRECT_URI);
    const second = await generateAuthData("claude", CLAUDE_MANUAL_REDIRECT_URI);

    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.codeChallenge).not.toBe(second.codeChallenge);
  });
});

describe("Claude callback redirect", () => {
  it("defaults to Anthropic's registered manual-code callback", () => {
    expect(defaultOAuthRedirectUri("claude")).toBe(CLAUDE_MANUAL_REDIRECT_URI);
  });

  it("leaves the generic dashboard callback to every other provider", () => {
    expect(defaultOAuthRedirectUri("codex")).toBeNull();
    expect(defaultOAuthRedirectUri("gemini-cli")).toBeNull();
  });
});

describe("Claude token refresh", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    __clearRefreshDedupCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the OAuth-only beta and the granted scope", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    }));

    const result = await refreshClaudeOAuthToken("old-refresh");

    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CLAUDE_TOKEN_URL);
    expect(init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    const body = JSON.parse(init.body);
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("old-refresh");
    // A refresh that omits the scope can come back down-scoped and drop the
    // Claude Code session and MCP grants the authorize step obtained.
    expect(body.scope).toBe(UPSTREAM_REFRESH_SCOPE);
  });

  it("keeps the previous refresh token when the rotation does not return one", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({
      access_token: "new-access",
      expires_in: 3600,
    }));

    const result = await refreshClaudeOAuthToken("old-refresh");

    expect(result.refreshToken).toBe("old-refresh");
  });

  it("reports an invalid grant as unrecoverable so the connection asks for a new sign-in", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refreshClaudeOAuthToken("dead-refresh");

    expect(result).toEqual({ error: "unrecoverable_refresh_error", code: "invalid_grant" });
    errorLog.mockRestore();
  });

  it("sends the same scope and beta header on the executor refresh path", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    }));

    const executor = new DefaultExecutor("claude");
    await executor.refreshCredentials({ refreshToken: "old-refresh" }, null, null);

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CLAUDE_TOKEN_URL);
    expect(init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(JSON.parse(init.body).scope).toBe(UPSTREAM_REFRESH_SCOPE);
  });

  it("keeps the console scope out of the refresh grant", () => {
    expect(PROVIDER_OAUTH.claude.refresh.scope).toBe(UPSTREAM_REFRESH_SCOPE);
    expect(PROVIDER_OAUTH.claude.refresh.scope).not.toContain("org:create_api_key");
  });
});

describe("Claude API-key behavior is unchanged", () => {
  it("keeps the API-key path on the plain first-party beta pin", () => {
    const executor = new DefaultExecutor("claude");

    const apiKeyHeaders = executor.buildHeaders({ apiKey: "sk-test" }, false);
    const oauthHeaders = executor.buildHeaders(
      { accessToken: "oauth-token", authType: "oauth" },
      false,
    );

    expect(apiKeyHeaders["x-api-key"]).toBe("sk-test");
    expect(apiKeyHeaders["Authorization"]).toBeUndefined();
    expect(apiKeyHeaders["Anthropic-Beta"]).not.toContain("oauth-2025-04-20");

    expect(oauthHeaders["Authorization"]).toBe("Bearer oauth-token");
    expect(oauthHeaders["x-api-key"]).toBeUndefined();
    expect(oauthHeaders["Anthropic-Beta"]).toContain("oauth-2025-04-20");
  });

  it("never refreshes an API-key-only connection", async () => {
    proxyAwareFetch.mockReset();
    const executor = new DefaultExecutor("claude");

    const result = await executor.refreshCredentials({ apiKey: "sk-test" }, null, null);

    expect(result).toBeNull();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
