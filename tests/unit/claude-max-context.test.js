import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  homedir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  exec: vi.fn(),
  platform: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    access: mocks.access,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
  },
  access: mocks.access,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));

vi.mock("os", () => ({
  default: {
    homedir: mocks.homedir,
    platform: mocks.platform,
  },
  homedir: mocks.homedir,
  platform: mocks.platform,
}));

vi.mock("child_process", () => ({
  exec: mocks.exec,
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual("next/server");
  return {
    ...actual,
    NextResponse: {
      json: (body, init) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  };
});

const { POST, DELETE } = await import("@/app/api/cli-tools/claude-settings/route.js");

describe("claude-settings maxContextTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.homedir.mockReturnValue("/home/test");
    mocks.platform.mockReturnValue("linux");
    mocks.exec.mockImplementation((_cmd, _opts, cb) => cb(null, { stdout: "/usr/bin/claude" }));
    mocks.readFile.mockRejectedValue({ code: "ENOENT" });
    mocks.writeFile.mockResolvedValue();
    mocks.mkdir.mockResolvedValue();
  });

  async function postBody(body) {
    const request = new Request("http://localhost/api/cli-tools/claude-settings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return POST(request);
  }

  it("stores CLAUDE_CODE_MAX_CONTEXT_TOKENS as a string when set", async () => {
    const response = await postBody({ env: { ANTHROPIC_BASE_URL: "http://gateway/9router" }, maxContextTokens: "198000" });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("198000");
  });

  it("removes CLAUDE_CODE_MAX_CONTEXT_TOKENS when value is empty", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      hasCompletedOnboarding: true,
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "198000", ANTHROPIC_BASE_URL: "http://gateway/9router/v1" },
    }));

    const response = await postBody({ env: { ANTHROPIC_BASE_URL: "http://gateway/9router" }, maxContextTokens: "" });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://gateway/9router/v1");
  });


  it("DELETE resets CLAUDE_CODE_MAX_CONTEXT_TOKENS", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      hasCompletedOnboarding: true,
      env: {
        ANTHROPIC_BASE_URL: "http://gateway/9router/v1",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "998000",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
      },
    }));

    const response = await DELETE();
    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    // DELETE removes all reset env keys; with no remaining env keys the empty
    // env object is also cleaned up.
    expect(written.env).toBeUndefined();
    expect(written.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
  });
});
