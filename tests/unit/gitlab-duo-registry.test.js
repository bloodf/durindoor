import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GitLab Duo registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the GitLab Duo environment URL over the legacy URL", async () => {
    vi.stubEnv("GITLAB_DUO_BASE_URL", "https://gitlab-duo.example.com");
    vi.stubEnv("GITLAB_BASE_URL", "https://legacy-gitlab.example.com");
    const mod = await import("../../open-sse/providers/registry/gitlab-duo.js");
    const entry = mod.default;
    expect(entry.oauth.defaultBaseUrl).toBe("https://gitlab-duo.example.com");
  });

  it("retains the legacy GitLab environment variable fallback", async () => {
    vi.stubEnv("GITLAB_DUO_BASE_URL", "");
    vi.stubEnv("GITLAB_BASE_URL", "https://legacy-gitlab.example.com");
    const mod = await import("../../open-sse/providers/registry/gitlab-duo.js");
    expect(mod.default.oauth.defaultBaseUrl).toBe("https://legacy-gitlab.example.com");
  });

  it("uses gitlab.com when neither environment variable is configured", async () => {
    vi.stubEnv("GITLAB_DUO_BASE_URL", "");
    vi.stubEnv("GITLAB_BASE_URL", "");
    const mod = await import("../../open-sse/providers/registry/gitlab-duo.js");
    expect(mod.default.oauth.defaultBaseUrl).toBe("https://gitlab.com");
  });
});
