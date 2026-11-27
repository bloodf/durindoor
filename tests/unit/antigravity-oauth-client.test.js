// Guards the deduped Antigravity OAuth client: same values across all 3 sources after refactor.
import { describe, it, expect } from "vitest";
import { afterAll, vi } from "vitest";

// The canonical-credential checks below run under an explicit operator
// override. The built-in default (both variables absent) and invalid
// overrides are covered at the end of this file.
const previousEnv = { ...process.env };
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "synthetic-override.apps.example.test";
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "synthetic-override-secret";
afterAll(() => { process.env = previousEnv; });
// Public desktop pair pinned from CLIProxyAPI
// internal/auth/antigravity/constants.go @ 47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e.
const DESKTOP = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
};

const EXPECTED = {
  clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || "",
};
const GOOGLE = {
  clientId: process.env.GEMINI_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.GEMINI_OAUTH_CLIENT_SECRET || "",
};

describe("antigravity oauth client (deduped)", () => {
  it("shared source holds the canonical credentials", async () => {
    const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ANTIGRAVITY_OAUTH_CLIENT).toEqual(EXPECTED);
  });

  it("registry transport keeps clientId/clientSecret", async () => {
    const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    expect(ag.transport.clientId).toBe(EXPECTED.clientId);
    expect(ag.transport.clientSecret).toBe(EXPECTED.clientSecret);
  });

  it("google client shared by gemini + gemini-cli", async () => {
    const { GOOGLE_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(GOOGLE_OAUTH_CLIENT).toEqual(GOOGLE);
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    const gc = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    expect(gemini.transport.clientSecret).toBe(GOOGLE.clientSecret);
    expect(gc.transport.clientSecret).toBe(GOOGLE.clientSecret);
  });

  // Guard: oauth.js must spread shared clients + derive from registry (PROVIDER_OAUTH).
  it("src oauth.js imports shared client + keeps full shape", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../../src/lib/oauth/constants/oauth.js"), "utf8");
    // Relative path (not bare "open-sse/...") so the module also loads under native Node ESM (#2313).
    expect(src).toMatch(/import \{ ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT \} from "(?:open-sse|(?:\.\.\/)+open-sse)\/providers\/shared\.js"/);
    expect(src).toContain("...ANTIGRAVITY_OAUTH_CLIENT");
    expect(src).toContain("...GOOGLE_OAUTH_CLIENT");
    // authorizeUrl now lives in registry; oauth.js derives via PROVIDER_OAUTH spread
    expect(src).toContain('PROVIDER_OAUTH["antigravity"]');
    expect(src).toContain('PROVIDER_OAUTH["gemini-cli"]');
    if (EXPECTED.clientSecret) {
      expect(src).not.toContain(EXPECTED.clientSecret); // antigravity secret no longer hardcoded here
    }
    if (GOOGLE.clientSecret) {
      expect(src).not.toContain(GOOGLE.clientSecret);   // gemini secret no longer hardcoded here
    }
  });
});

describe("antigravity oauth client profiles", () => {
  it("both overrides absent selects the desktop pair everywhere, with six scopes and the loopback", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
    try {
      const shared = await import("../../open-sse/providers/shared.js");
      expect(shared.ANTIGRAVITY_OAUTH_CLIENT).toEqual(DESKTOP);
      expect(shared.ANTIGRAVITY_OAUTH_PROFILE).toEqual({ profile: "desktop", configError: null });
      const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
      expect(ag.transport.clientId).toBe(DESKTOP.clientId);
      const { ANTIGRAVITY_CONFIG } = await import("../../src/lib/oauth/constants/oauth.js");
      expect(ANTIGRAVITY_CONFIG.clientId).toBe(DESKTOP.clientId);
      expect(ANTIGRAVITY_CONFIG.scopes).toContain("https://www.googleapis.com/auth/aicode");
      expect(ANTIGRAVITY_CONFIG.scopes).toHaveLength(6);
      expect(ANTIGRAVITY_CONFIG.fixedRedirectUri).toBe("http://localhost:51121/oauth-callback");
    } finally {
      process.env = saved;
      vi.resetModules();
    }
  });

  it("an explicit override keeps the existing five scopes and the caller redirect", async () => {
    const { ANTIGRAVITY_CONFIG } = await import("../../src/lib/oauth/constants/oauth.js");
    expect(ANTIGRAVITY_CONFIG.oauthProfile).toBe("custom");
    expect(ANTIGRAVITY_CONFIG.scopes).not.toContain("https://www.googleapis.com/auth/aicode");
    expect(ANTIGRAVITY_CONFIG.scopes).toHaveLength(5);
    expect(ANTIGRAVITY_CONFIG.fixedRedirectUri).toBeNull();
  });

  it("invalid overrides resolve to no client, never the desktop pair", async () => {
    const { resolveAntigravityOAuthClient } = await import("../../open-sse/providers/shared.js");
    expect(resolveAntigravityOAuthClient({})).toMatchObject({ profile: "desktop", ...DESKTOP });
    for (const env of [
      { ANTIGRAVITY_OAUTH_CLIENT_ID: "", ANTIGRAVITY_OAUTH_CLIENT_SECRET: "" },
      { ANTIGRAVITY_OAUTH_CLIENT_ID: "only-id" },
      { ANTIGRAVITY_OAUTH_CLIENT_SECRET: "only-secret" },
    ]) {
      const result = resolveAntigravityOAuthClient(env);
      expect(result).toMatchObject({ profile: "invalid", clientId: "", clientSecret: "" });
      expect(result.configError).toMatch(/ANTIGRAVITY_OAUTH_CLIENT_(ID|SECRET)/);
    }
  });

  it("the pinned desktop pair lives only in open-sse/providers/shared.js", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/lib/oauth/constants/oauth.js", import.meta.url), "utf8");
    expect(src).not.toContain(DESKTOP.clientSecret);
    expect(src).not.toContain(DESKTOP.clientId);
  });
});
