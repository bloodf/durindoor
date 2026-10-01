import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOAuthRedirectUri,
  isLoopbackHostname,
  publicBaseUrl,
} from "../../src/lib/oauth/redirectUri.js";
import { generateAuthData, getProvider } from "../../src/lib/oauth/providers.js";

// A TLS-terminating reverse proxy in front of DurinDoor: the dashboard is
// reached at https://router.ai.public.domain, so window.location.port is ""
// and the implicit port is 443. See upstream issue #4054.
const httpsPublic = {
  hostname: "router.ai.public.domain",
  port: "",
  protocol: "https:",
  origin: "https://router.ai.public.domain",
};

const localhostApp = {
  hostname: "localhost",
  port: "20128",
  protocol: "http:",
  origin: "http://localhost:20128",
};

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

describe("isLoopbackHostname", () => {
  it("recognises every loopback spelling", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST", " Localhost "]) {
      expect(isLoopbackHostname(host)).toBe(true);
    }
  });

  it("does not treat a routable host as loopback", () => {
    for (const host of ["router.ai.public.domain", "durindoor.internal", "192.168.1.10", "0.0.0.0", "", null]) {
      expect(isLoopbackHostname(host)).toBe(false);
    }
  });
});

describe("publicBaseUrl", () => {
  it("returns the origin without a trailing slash", () => {
    expect(publicBaseUrl({ origin: "https://router.example.com" })).toBe("https://router.example.com");
    expect(publicBaseUrl({ origin: "https://router.example.com/" })).toBe("https://router.example.com");
  });

  it("rebuilds from protocol and host when origin is unavailable", () => {
    expect(
      publicBaseUrl({ protocol: "https:", host: "router.example.com:8443", origin: "" }),
    ).toBe("https://router.example.com:8443");
  });

  it("prefers the operator-configured NEXT_PUBLIC_BASE_URL over window.location.origin", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://durindoor.example.com/";
    expect(publicBaseUrl({ origin: "https://internal-proxy-host:8080" })).toBe("https://durindoor.example.com");
  });
});

describe("buildOAuthRedirectUri", () => {
  // Hosted dashboards cannot use arbitrary Claude redirect origins: Anthropic
  // accepts its own manual-code callback for this OAuth client.
  it("uses Claude's registered manual-code redirect on a hosted dashboard", () => {
    expect(buildOAuthRedirectUri(httpsPublic, "claude"))
      .toBe("https://platform.claude.com/oauth/code/callback");
  });

  it("uses Claude's registered redirect on loopback installs too", () => {
    expect(buildOAuthRedirectUri(localhostApp, "claude"))
      .toBe("https://platform.claude.com/oauth/code/callback");
  });
  it("uses one registered redirect for authorization and token exchange", async () => {
    const redirectUri = buildOAuthRedirectUri(httpsPublic, "claude");
    const auth = await generateAuthData("claude", redirectUri);
    const url = new URL(auth.authUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) });
    try {
      await getProvider("claude").exchangeToken(
        getProvider("claude").config, "one-use-code", redirectUri, auth.codeVerifier, auth.state,
      );
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
        redirect_uri: redirectUri,
        state: auth.state,
        code_verifier: auth.codeVerifier,
      });
    } finally {
      fetch.mockRestore();
    }
  });


  it("keeps the dashboard callback for other providers", () => {
    expect(buildOAuthRedirectUri(localhostApp, "gemini-cli"))
      .toBe("http://localhost:20128/callback");
    expect(buildOAuthRedirectUri({ hostname: "10.0.0.5", origin: "http://10.0.0.5:20128" }, "iflow"))
      .toBe("http://10.0.0.5:20128/callback");
  });

  it("leaves the fixed-port loopback redirects for codex and xai untouched", () => {
    expect(buildOAuthRedirectUri(httpsPublic, "codex")).toBe("http://localhost:1455/auth/callback");
    expect(buildOAuthRedirectUri(httpsPublic, "xai")).toBe("http://127.0.0.1:56121/callback");
  });

  it("follows the public base URL for providers with dashboard callbacks", () => {
    for (const provider of ["gemini-cli", "iflow", "qoder", "cursor", "kimi", "zed"]) {
      expect(buildOAuthRedirectUri(httpsPublic, provider)).toBe(
        "https://router.ai.public.domain/callback",
      );
    }
  });

  it("uses the operator-configured NEXT_PUBLIC_BASE_URL for a non-loopback install behind a proxy", () => {
    // The proxy's Host may differ from the operator's public origin (e.g. a
    // reverse proxy that rewrites Host to an internal name); NEXT_PUBLIC_BASE_URL
    // is the browser-visible override documented in docs/reference/environment.mdx.
    process.env.NEXT_PUBLIC_BASE_URL = "https://durindoor.example.com";
    expect(buildOAuthRedirectUri(httpsPublic, "gemini-cli")).toBe("https://durindoor.example.com/callback");
  });
});
