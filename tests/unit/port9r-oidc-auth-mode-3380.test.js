/**
 * Upstream 9router PR #3380: the OIDC-only auth mode ("sso") must be recognised
 * so OIDC login can start. DurinDoor shares ~/.9router settings with 9router
 * installs, which store "sso" for OIDC-only login.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const { getOidcRuntimeConfig, isOidcAuthMode } = await import("../../src/lib/auth/oidc.js");

const configured = {
  oidcIssuerUrl: "https://idp.example.com/application/o/durindoor/",
  oidcClientId: "client-id",
  oidcClientSecret: "client-secret",
};

describe("isOidcAuthMode", () => {
  it("accepts sso, oidc and both", () => {
    for (const mode of ["sso", "oidc", "both"]) expect(isOidcAuthMode(mode)).toBe(true);
  });
  it("rejects password-only and missing modes", () => {
    expect(isOidcAuthMode("password")).toBe(false);
    expect(isOidcAuthMode(undefined)).toBe(false);
  });
});

describe("getOidcRuntimeConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a config for the OIDC-only sso mode", async () => {
    mocks.getSettings.mockResolvedValue({ ...configured, authMode: "sso" });
    const config = await getOidcRuntimeConfig();
    expect(config).not.toBeNull();
    expect(config.issuerUrl).toBe("https://idp.example.com/application/o/durindoor");
    expect(config.clientId).toBe("client-id");
  });

  it("still resolves for oidc and both", async () => {
    for (const authMode of ["oidc", "both"]) {
      mocks.getSettings.mockResolvedValue({ ...configured, authMode });
      expect(await getOidcRuntimeConfig()).not.toBeNull();
    }
  });

  it("returns null for password-only login", async () => {
    mocks.getSettings.mockResolvedValue({ ...configured, authMode: "password" });
    expect(await getOidcRuntimeConfig()).toBeNull();
  });

  it("returns null when sso is set but credentials are missing", async () => {
    mocks.getSettings.mockResolvedValue({ authMode: "sso", oidcIssuerUrl: "" });
    expect(await getOidcRuntimeConfig()).toBeNull();
  });
});
