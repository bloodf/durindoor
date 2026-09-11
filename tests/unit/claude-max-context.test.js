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

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: mocks.homedir,
      platform: mocks.platform,
    },
    homedir: mocks.homedir,
    platform: mocks.platform,
  };
});

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

const { withContextMarker } = await import("@/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js");

describe("Claude Code 1M context marker", () => {
  it("preserves custom model IDs and keeps repeated toggles idempotent", () => {
    expect(withContextMarker("vendor/custom-opus", true)).toBe("vendor/custom-opus[1m]");
    expect(withContextMarker("vendor/custom-opus[1m][1m]", true)).toBe("vendor/custom-opus[1m]");
    expect(withContextMarker("vendor/custom-opus[1M]", false)).toBe("vendor/custom-opus");
  });
});

describe("claude-settings autoCompactWindow", () => {
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

  it("persists the auto-compact window and marked custom models while preserving unrelated settings", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      permissions: { allow: ["Bash(npm test:*)"] },
      env: {
        CUSTOM_ENV: "keep-me",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "998000",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom/old-model",
      },
    }));

    const response = await postBody({
      env: {
        ANTHROPIC_BASE_URL: "http://gateway/9router",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/custom/opus[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom/haiku[1m]",
      },
      autoCompactWindow: "698000",
    });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.permissions).toEqual({ allow: ["Bash(npm test:*)"] });
    expect(written.env).toMatchObject({
      CUSTOM_ENV: "keep-me",
      ANTHROPIC_BASE_URL: "http://gateway/9router/v1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "custom/opus[1m]",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "custom/haiku[1m]",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "698000",
    });
    expect(written.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
  });

  it("uses Default to unset both the effective key and the retired key", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      env: {
        CUSTOM_ENV: "keep-me",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "498000",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "998000",
      },
    }));

    const response = await postBody({ env: {}, autoCompactWindow: "" });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env).toEqual({ CUSTOM_ENV: "keep-me" });
  });

  it.each(["100000", "998000", 698000, null])(
    "rejects unsupported auto-compact input %s without writing",
    async (autoCompactWindow) => {
      const response = await postBody({ env: {}, autoCompactWindow });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid auto-compact window" });
      expect(mocks.mkdir).not.toHaveBeenCalled();
      expect(mocks.writeFile).not.toHaveBeenCalled();
    },
  );

  it("rejects non-string model mappings without corrupting settings", async () => {
    const response = await postBody({
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: { model: "custom/opus[1m]" } },
      autoCompactWindow: "198000",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid model mapping" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("DELETE resets current and retired context keys but preserves unrelated env", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      permissions: { deny: ["Read(.env)"] },
      env: {
        ANTHROPIC_BASE_URL: "http://gateway/9router/v1",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "698000",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "998000",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "custom/opus[1m]",
        CUSTOM_ENV: "keep-me",
      },
    }));

    const response = await DELETE();

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.permissions).toEqual({ deny: ["Read(.env)"] });
    expect(written.env).toEqual({ CUSTOM_ENV: "keep-me" });
  });
});
