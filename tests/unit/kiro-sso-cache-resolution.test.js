import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Focused tests for 9router PR #2615: unified AWS SSO cache resolution for
// Kiro native external_idp refresh-token import/validation.
//
// Covers the acceptance trio:
//  1. valid   — a generic imported credential (refreshToken only) is enriched
//               from the exact-match cache entry and refreshes against the
//               Microsoft endpoint only.
//  2. invalid — a cache entry that is not a Kiro token is rejected (no
//               enrichment, no network I/O).
//  3. cache   — exact refresh-token match wins over the preferred
//               `kiro-auth-token.json` file, and a clientIdHash-linked
//               registration file supplies clientId/clientSecret.

const TEST_CLIENT_ID = "00000000-0000-4000-8000-000000000000";
const TEST_TOKEN_ENDPOINT = "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token";
const TEST_SCOPE = `api://${TEST_CLIENT_ID}/codewhisperer:conversations offline_access`;
const TEST_REFRESH = "1.external-idp-refresh-token";
const TEST_ARN = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/ABC";
const TEST_EMAIL = "user@example.com";

function makeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

function externalIdpCacheEntry(overrides = {}) {
  return {
    authMethod: "external_idp",
    accessToken: "cached-access-token",
    refreshToken: TEST_REFRESH,
    clientId: TEST_CLIENT_ID,
    tokenEndpoint: TEST_TOKEN_ENDPOINT,
    scopes: TEST_SCOPE.split(" "),
    region: "eu-central-1",
    ...overrides,
  };
}

function ssoFsMock(entries, { profileArn = TEST_ARN, profileError = null } = {}) {
  // entries: { [fileName]: object | "__INVALID_JSON__" }
  const files = Object.keys(entries);
  return {
    readdir: vi.fn(async () => files),
    readFile: vi.fn(async (path) => {
      for (const [name, data] of Object.entries(entries)) {
        if (path.endsWith(`/${name}`)) {
          if (data === "__INVALID_JSON__") return "{not json";
          return JSON.stringify(data);
        }
      }
      if (path.endsWith("profile.json")) {
        if (profileError) throw profileError;
        return JSON.stringify({ arn: profileArn });
      }
      const err = new Error(`ENOENT: ${path}`);
      err.code = "ENOENT";
      throw err;
    }),
  };
}

async function loadModules(fsImpl) {
  vi.resetModules();
  vi.doMock("fs/promises", () => fsImpl);
  vi.doMock("os", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, homedir: () => "/home/tester" };
  });
  const kiroModels = await import("../../open-sse/services/kiroModels.js");
  const providers = await import("../../open-sse/services/tokenRefresh/providers.js");
  const dedup = await import("../../open-sse/services/tokenRefresh/dedup.js");
  dedup.__clearRefreshDedupCacheForTesting();
  return { kiroModels, providers, dedup };
}

describe("Kiro unified SSO cache resolution (9router #2615)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("fs/promises");
    vi.doUnmock("os");
    vi.unstubAllGlobals();
    vi.resetModules(); // drop the fs/os-mocked module graph so later suites import clean modules
  });

  it("accepts external_idp, builder-id prefix, and codewhisperer-scoped cache entries", async () => {
    const { kiroModels } = await loadModules(ssoFsMock({}));
    const { isKiroSsoToken } = kiroModels;

    expect(isKiroSsoToken(externalIdpCacheEntry())).toBe(true);
    expect(isKiroSsoToken({ refreshToken: "aorAAAAAGbuilder-id-token" })).toBe(true);
    expect(isKiroSsoToken({ refreshToken: "org-token", scopes: ["codewhisperer:conversations"] })).toBe(true);

    expect(isKiroSsoToken(null)).toBe(false);
    expect(isKiroSsoToken({})).toBe(false);
    expect(isKiroSsoToken({ refreshToken: "" })).toBe(false);
    expect(isKiroSsoToken({ refreshToken: "unrelated-token" })).toBe(false);
  });

  it("resolves a valid external_idp cache entry by exact refresh-token match, preserving ARN region verbatim", async () => {
    const { kiroModels } = await loadModules(ssoFsMock({
      "kiro-auth-token.json": { refreshToken: "aorAAAAAGsomeone-else" },
      "deadbeef.json": externalIdpCacheEntry(),
    }));

    const cached = await kiroModels.resolveKiroCredentialsFromSsoCache(TEST_REFRESH);

    expect(cached.source).toBe("deadbeef.json");
    expect(cached.refreshToken).toBe(TEST_REFRESH);
    expect(cached.authMethod).toBe("external_idp");
    expect(cached.region).toBe("eu-central-1");
    expect(cached.profileArn).toBe(TEST_ARN); // verbatim, NOT rewritten to us-east-1
    expect(cached.rawAuth).toMatchObject({
      auth_method: "external_idp",
      client_id: TEST_CLIENT_ID,
      token_endpoint: TEST_TOKEN_ENDPOINT,
      profile_arn: TEST_ARN,
    });
  });

  it("enriches a generic imported credential from the cache and refreshes via the Microsoft endpoint only", async () => {
    const { kiroModels, providers } = await loadModules(ssoFsMock({
      "sso-entry.json": externalIdpCacheEntry(),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    // Generic imported credential: refresh token only, no usable metadata.
    const credentials = {
      refreshToken: TEST_REFRESH,
      providerSpecificData: { authMethod: "imported" },
    };

    const enriched = await kiroModels.enrichKiroCredentialsFromSsoCache(credentials);
    expect(enriched.providerSpecificData).toMatchObject({
      authMethod: "external_idp",
      clientId: TEST_CLIENT_ID,
      tokenEndpoint: TEST_TOKEN_ENDPOINT,
      scope: TEST_SCOPE,
      profileArn: TEST_ARN,
      region: "eu-central-1",
    });

    const result = await providers.refreshKiroToken(
      enriched.refreshToken,
      enriched.providerSpecificData,
      null,
      null,
    );

    expect(result).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "rotated-refresh-token",
    });

    // The Microsoft token endpoint is the ONLY network call — no AWS OIDC or
    // social endpoint is touched for an external_idp token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(TEST_TOKEN_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain(`refresh_token=${encodeURIComponent(TEST_REFRESH)}`);
  });

  it("rejects a non-Kiro cache entry without enrichment or network I/O", async () => {
    const { kiroModels } = await loadModules(ssoFsMock({
      "sso-entry.json": { refreshToken: TEST_REFRESH, someOtherApp: true },
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      kiroModels.resolveKiroCredentialsFromSsoCache(TEST_REFRESH),
    ).rejects.toThrow(/not found/i);

    const credentials = {
      refreshToken: TEST_REFRESH,
      providerSpecificData: { authMethod: "imported" },
    };
    const enriched = await kiroModels.enrichKiroCredentialsFromSsoCache(credentials);
    expect(enriched).toBe(credentials); // unchanged
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exact refresh-token match wins over the preferred kiro-auth-token.json", async () => {
    const { kiroModels } = await loadModules(ssoFsMock({
      "kiro-auth-token.json": { refreshToken: "aorAAAAAGpreferred-file-token" },
      "other.json": externalIdpCacheEntry(),
    }));

    const cached = await kiroModels.resolveKiroCredentialsFromSsoCache(TEST_REFRESH);
    expect(cached.source).toBe("other.json");
    expect(cached.authMethod).toBe("external_idp");

    // And a target that matches the preferred file resolves from it.
    const preferred = await kiroModels.resolveKiroCredentialsFromSsoCache("aorAAAAAGpreferred-file-token");
    expect(preferred.source).toBe("kiro-auth-token.json");
    expect(preferred.refreshToken).toBe("aorAAAAAGpreferred-file-token");
  });

  it("resolves clientId/clientSecret from the clientIdHash-linked registration file for IDC entries", async () => {
    const { kiroModels } = await loadModules(ssoFsMock({
      "org-token.json": {
        refreshToken: "org-refresh-token",
        scopes: ["codewhisperer:conversations"],
        authMethod: "idc",
        region: "eu-central-1",
        clientIdHash: "cafebabe",
      },
      "cafebabe.json": { clientId: "idc-client-id", clientSecret: "idc-client-secret" },
    }));

    const cached = await kiroModels.resolveKiroCredentialsFromSsoCache("org-refresh-token");
    expect(cached.clientId).toBe("idc-client-id");
    expect(cached.clientSecret).toBe("idc-client-secret");
    expect(cached.authMethod).toBe("idc");
    expect(cached.rawAuth).toBeUndefined(); // rawAuth only for external_idp

    // An explicit IDC credential missing the registration pair is enriched.
    const credentials = {
      refreshToken: "org-refresh-token",
      providerSpecificData: { authMethod: "idc", profileArn: TEST_ARN },
    };
    const enriched = await kiroModels.enrichKiroCredentialsFromSsoCache(credentials);
    expect(enriched.providerSpecificData).toMatchObject({
      authMethod: "idc",
      clientId: "idc-client-id",
      clientSecret: "idc-client-secret",
    });
  });

  it("returns the credential unchanged when all metadata is already present", async () => {
    const fsImpl = ssoFsMock({ "entry.json": externalIdpCacheEntry() });
    const { kiroModels } = await loadModules(fsImpl);

    const credentials = {
      refreshToken: TEST_REFRESH,
      providerSpecificData: {
        authMethod: "external_idp",
        clientId: TEST_CLIENT_ID,
        tokenEndpoint: TEST_TOKEN_ENDPOINT,
        scope: TEST_SCOPE,
        profileArn: TEST_ARN,
      },
    };

    const enriched = await kiroModels.enrichKiroCredentialsFromSsoCache(credentials);
    expect(enriched).toBe(credentials);
    expect(fsImpl.readFile).not.toHaveBeenCalled(); // no cache scan needed
  });

  it("ignores a clientIdHash that is not a plain hex hash (path traversal guard)", async () => {
    const fsImpl = ssoFsMock({
      "org-token.json": {
        refreshToken: "org-refresh-token",
        scopes: ["codewhisperer:conversations"],
        authMethod: "idc",
        clientIdHash: "../../../../etc/passwd",
      },
    });
    const { kiroModels } = await loadModules(fsImpl);

    const cached = await kiroModels.resolveKiroCredentialsFromSsoCache("org-refresh-token");
    expect(cached.clientId).toBeNull();
    expect(cached.clientSecret).toBeNull();
    // readFile was only called for cache entries + profile paths, never a traversal path.
    for (const call of fsImpl.readFile.mock.calls) {
      expect(String(call[0])).not.toContain("..");
    }
  });

  it("returns null from refreshKiroToken when the Microsoft 200 response lacks access_token", async () => {
    const fsImpl = ssoFsMock({ "entry.json": externalIdpCacheEntry() });
    const { providers } = await loadModules(fsImpl);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ expires_in: 3600 }), // HTTP 200 but no access_token
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await providers.refreshKiroToken(TEST_REFRESH, {
      authMethod: "external_idp",
      clientId: TEST_CLIENT_ID,
      tokenEndpoint: TEST_TOKEN_ENDPOINT,
      scope: TEST_SCOPE,
    }, null);

    expect(result).toBeNull();
  });
});

/**
 * Load the /api/oauth/kiro/import route with all its boundaries mocked:
 * fs/os for the SSO cache, next/server for NextResponse, @/models for
 * createProviderConnection. Returns { POST, created }.
 */
async function loadImportRoute(fsImpl) {
  vi.resetModules();
  vi.doMock("fs/promises", () => fsImpl);
  vi.doMock("os", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, homedir: () => "/home/tester" };
  });
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  const created = [];
  vi.doMock("@/models", () => ({
    createProviderConnection: vi.fn(async (data) => {
      const connection = { id: "conn-1", ...data };
      created.push(connection);
      return connection;
    }),
  }));
  const route = await import("../../src/app/api/oauth/kiro/import/route.js");
  return { POST: route.POST, created };
}

function postImport(body) {
  return new Request("https://durindoor.local/api/oauth/kiro/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/oauth/kiro/import — native external_idp import (9router #2615)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("fs/promises");
    vi.doUnmock("os");
    vi.doUnmock("next/server");
    vi.doUnmock("@/models");
    vi.unstubAllGlobals();
    vi.resetModules(); // drop mocked module graph so later suites import clean modules
  });

  it("imports a bare external_idp refresh token via the Microsoft endpoint only and persists the metadata", async () => {
    const { POST, created } = await loadImportRoute(ssoFsMock({
      "sso-entry.json": externalIdpCacheEntry({
        accessToken: makeJwt({ preferred_username: TEST_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 }),
      }),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: makeJwt({ preferred_username: TEST_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 }),
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(postImport({ refreshToken: TEST_REFRESH }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // Microsoft token endpoint is the ONLY network call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(TEST_TOKEN_ENDPOINT);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      provider: "kiro",
      authType: "oauth",
      refreshToken: "rotated-refresh-token",
      email: TEST_EMAIL,
      providerSpecificData: {
        authMethod: "external_idp",
        clientId: TEST_CLIENT_ID,
        tokenEndpoint: TEST_TOKEN_ENDPOINT,
        scope: TEST_SCOPE,
        profileArn: TEST_ARN,
        region: "eu-central-1",
      },
      testStatus: "active",
    });
  });

  it("falls through to the standard flow (and fails there) when the cache has no matching token", async () => {
    const { POST, created } = await loadImportRoute(ssoFsMock({
      "sso-entry.json": { refreshToken: "aorAAAAAGsomeone-else" },
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "invalid_grant",
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(postImport({ refreshToken: TEST_REFRESH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(created).toHaveLength(0);
    // No Microsoft endpoint call — the token was never cache-validated.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("login.microsoftonline.com");
    }
  });

  it("rejects a cache entry whose tokenEndpoint is not a Microsoft login host", async () => {
    const { POST, created } = await loadImportRoute(ssoFsMock({
      "sso-entry.json": externalIdpCacheEntry({
        tokenEndpoint: "https://evil.example.com/token",
      }),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "invalid_grant",
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(postImport({ refreshToken: TEST_REFRESH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(created).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("evil.example.com"),
      expect.anything(),
    );
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("evil.example.com");
    }
  });
});
