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

const { POST } = await import("@/app/api/cli-tools/claude-settings/route.js");
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";

describe("claude-settings POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.homedir.mockReturnValue("/home/test");
    mocks.platform.mockReturnValue("linux");
    mocks.exec.mockImplementation((_cmd, _opts, cb) => cb(null, { stdout: "/usr/bin/claude" }));
    mocks.readFile.mockRejectedValue({ code: "ENOENT" });
    mocks.writeFile.mockResolvedValue();
    mocks.mkdir.mockResolvedValue();
  });

  async function postEnv(env) {
    const request = new Request("http://localhost/api/cli-tools/claude-settings", {
      method: "POST",
      body: JSON.stringify({ env }),
    });
    return POST(request);
  }

  it("strips cc/ prefix from ANTHROPIC_DEFAULT_*_MODEL values", async () => {
    const response = await postEnv({
      ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-5",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc/claude-haiku-4-5-20251001",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "cc/claude-fable-5-1",
    });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-opus-5");
    expect(written.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5");
    expect(written.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(written.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-1");
  });

  it("preserves non-cc namespaced model IDs", async () => {
    const response = await postEnv({
      ANTHROPIC_DEFAULT_OPUS_MODEL: "acme/claude-opus-5",
    });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("acme/claude-opus-5");
  });

  it("leaves bare model IDs unchanged", async () => {
    const response = await postEnv({
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
    });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-opus-5");
  });

  it("normalizes ANTHROPIC_BASE_URL to end with /v1", async () => {
    const response = await postEnv({
      ANTHROPIC_BASE_URL: "http://gateway/9router",
    });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://gateway/9router/v1");
  });

  it("keeps ANTHROPIC_BASE_URL unchanged when it already ends with /v1", async () => {
    const response = await postEnv({
      ANTHROPIC_BASE_URL: "http://gateway/9router/v1",
    });

    expect(response.status).toBe(200);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][1]);
    expect(written.env.ANTHROPIC_BASE_URL).toBe("http://gateway/9router/v1");
  });

  it("includes opus[1m] and sonnet[1m] aliases", () => {
    expect(CLI_TOOLS.claude.modelAliases).toContain("opus[1m]");
    expect(CLI_TOOLS.claude.modelAliases).toContain("sonnet[1m]");
  });

  it("maps Claude defaults to Fable 5.1 without changing Opus", () => {
    const opus = CLI_TOOLS.claude.defaultModels.find((m) => m.id === "opus");
    expect(opus.defaultValue).toBe("cc/claude-opus-5");
    const sonnet = CLI_TOOLS.claude.defaultModels.find((m) => m.id === "sonnet");
    expect(sonnet.defaultValue).toBe("cc/claude-sonnet-5");
    const fable = CLI_TOOLS.claude.defaultModels.find((m) => m.id === "fable");
    expect(fable.defaultValue).toBe("cc/claude-fable-5-1");
    const haiku = CLI_TOOLS.claude.defaultModels.find((m) => m.id === "haiku");
    expect(haiku.defaultValue).toBe("cc/claude-haiku-4-5-20251001");
  });
});
