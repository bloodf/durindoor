import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ homedir: vi.fn() }));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: mocks.homedir }, homedir: mocks.homedir };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200 }),
  },
}));

const { GET } = await import("@/app/api/cli-tools/codex-settings/route.js");
let tempDir;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  vi.clearAllMocks();
});

describe("Codex settings GET redaction", () => {
  it("redacts MCP environment, headers, argument secrets, and URL userinfo", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-redaction-"));
    mocks.homedir.mockReturnValue(tempDir);
    const codexDir = path.join(tempDir, ".codex");
    await fs.mkdir(codexDir, { mode: 0o700 });
    const configPath = path.join(codexDir, "config.toml");
    const original = `[mcp_servers.example]\nurl = "https://alice:db-password@example.test/mcp"\nargs = ["--api-token=cli-secret", "--password", "arg-secret"]\n\n[mcp_servers.example.env]\nAWS_SECRET_ACCESS_KEY = "aws-secret"\nGITHUB_PAT = "github-secret"\nDATABASE_URL = "postgres://db-user:db-secret@db.example/app"\n\n[mcp_servers.example.http_headers]\nX-Custom-Auth = "header-secret"\n\n[mcp_servers.example.env_http_headers]\nAuthorization = "bearer-secret"\n\n[mcp_servers.example.headers]\nX-Other = "other-secret"\n`;
    await fs.writeFile(configPath, original, { mode: 0o600 });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toContain('"https://[REDACTED]@example.test/mcp"');
    for (const secret of ["aws-secret", "github-secret", "db-secret", "header-secret", "bearer-secret", "other-secret", "cli-secret", "arg-secret"]) {
      expect(body.config).not.toContain(secret);
    }
    expect(body.config).toContain('"--api-token=[REDACTED]"');
    expect(body.config).toContain('"--password", "[REDACTED]"');
    expect(await fs.readFile(configPath, "utf8")).toBe(original);
  });
});
