import { describe, it, expect, vi, beforeEach } from "vitest";

describe("GitLab Duo registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it("falls back to env-configured base URL when no connection baseUrl is set", async () => {
    vi.stubEnv("GITLAB_DUO_BASE_URL", "https://gitlab-duo.example.com");
    const mod = await import("../../open-sse/providers/registry/gitlab-duo.js");
    const entry = mod.default;
    expect(entry.oauth.defaultBaseUrl).toBe("https://gitlab-duo.example.com");
    vi.unstubAllEnvs();
  });
});
