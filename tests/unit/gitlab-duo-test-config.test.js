import { describe, it, expect, vi } from "vitest";
import { OAUTH_TEST_CONFIG } from "../../src/app/api/providers/[id]/test/testUtils.js";

describe("GitLab Duo test config", () => {
  it("defines a gitlab-duo entry that probes the connection base URL", () => {
    const config = OAUTH_TEST_CONFIG["gitlab-duo"];
    expect(config).toBeDefined();
    expect(typeof config.buildUrl).toBe("function");
    expect(config.method).toBe("GET");
    expect(config.authHeader).toBe("Authorization");
    expect(config.authPrefix).toBe("Bearer ");

    const withBase = {
      providerSpecificData: { baseUrl: "https://gitlab.example.com" },
    };
    expect(config.buildUrl("token", withBase)).toBe("https://gitlab.example.com/api/v4/user");

    const fallback = { providerSpecificData: {} };
    vi.stubEnv("GITLAB_DUO_BASE_URL", "https://duo.example.com");
    expect(config.buildUrl("token", fallback)).toBe("https://duo.example.com/api/v4/user");
    vi.unstubAllEnvs();
  });
});
