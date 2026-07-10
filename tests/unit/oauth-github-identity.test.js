// Upstream port #2498: GitHub (Copilot) OAuth mapTokens must surface account
// identity (login / display name / email) at the connection top level so the
// connection store can label multiple accounts distinctly instead of falling
// back to a generic "Account N" name.
import { describe, it, expect } from "vitest";

describe("github OAuth mapTokens — account identity (upstream #2498)", () => {
  it("maps userInfo.login/name/email to top-level name/displayName/email", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const github = getProvider("github");

    const mapped = github.mapTokens(
      { access_token: "gho_xxx", refresh_token: "ghr_yyy", expires_in: 3600 },
      {
        copilotToken: { token: "cop_tok", expires_at: 1234567890 },
        userInfo: { id: 42, login: "octocat", name: "The Octocat", email: "octo@example.com" },
      },
    );

    expect(mapped.accessToken).toBe("gho_xxx");
    expect(mapped.refreshToken).toBe("ghr_yyy");
    expect(mapped.name).toBe("octocat");
    expect(mapped.displayName).toBe("The Octocat");
    expect(mapped.email).toBe("octo@example.com");
    expect(mapped.providerSpecificData.githubLogin).toBe("octocat");
    expect(mapped.providerSpecificData.githubName).toBe("The Octocat");
    expect(mapped.providerSpecificData.githubEmail).toBe("octo@example.com");
    expect(mapped.providerSpecificData.githubUserId).toBe(42);
    expect(mapped.providerSpecificData.copilotToken).toBe("cop_tok");
    expect(mapped.providerSpecificData.copilotTokenExpiresAt).toBe(1234567890);
  });

  it("falls back gracefully when optional userInfo fields are missing", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const github = getProvider("github");

    // name missing → top-level name falls back to login; displayName falls back to login
    const noDisplayName = github.mapTokens(
      { access_token: "a" },
      { userInfo: { login: "loginonly" } },
    );
    expect(noDisplayName.name).toBe("loginonly");
    expect(noDisplayName.displayName).toBe("loginonly");
    expect(noDisplayName.email).toBeNull();

    // no userInfo at all → identity fields null/undefined, no throw
    const noUser = github.mapTokens({ access_token: "b" }, {});
    expect(noUser.name).toBeUndefined();
    expect(noUser.displayName).toBeUndefined();
    expect(noUser.email).toBeNull();
    expect(noUser.providerSpecificData.githubLogin).toBeUndefined();

    // extra entirely absent (defensive) → no throw
    const noExtra = github.mapTokens({ access_token: "c" });
    expect(noExtra.email).toBeNull();
    expect(noExtra.providerSpecificData.copilotToken).toBeUndefined();
  });
});
