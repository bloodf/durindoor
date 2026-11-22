import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const mocks = vi.hoisted(() => ({ homedir: vi.fn(), setMitmAliasAll: vi.fn() }));
vi.mock("os", () => ({ default: { homedir: mocks.homedir }, homedir: mocks.homedir }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200 }) } }));
vi.mock("@/models", () => ({ getMitmAlias: vi.fn(), setMitmAliasAll: mocks.setMitmAliasAll }));
vi.mock("@/mitm/manager", () => ({ getMitmStatus: vi.fn(async () => ({ dnsStatus: {} })) }));
vi.mock("@/lib/mitmAliasCache", () => ({ writeAliasForTool: vi.fn() }));

const { POST } = await import("@/app/api/cli-tools/codex-settings/route.js");
const { PUT } = await import("@/app/api/cli-tools/antigravity-mitm/alias/route.js");
let home;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(process.cwd(), ".tmp-l-cli-perms-"));
  mocks.homedir.mockReturnValue(home);
});
afterEach(async () => fs.rm(home, { recursive: true, force: true }));

describe("CLI credential config permissions", () => {
  it("writes Codex auth.json with owner-only permissions", async () => {
    const response = await POST(new Request("http://localhost/api/cli-tools/codex-settings", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "http://localhost:20128", apiKey: "sk-test", model: "test-model" }),
    }));
    expect(response.status).toBe(200);
    const stat = await fs.stat(path.join(home, ".codex", "auth.json"));
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("Antigravity alias tool validation", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("rejects prototype key %s", async (tool) => {
    const response = await PUT(new Request("http://localhost/api/cli-tools/antigravity-mitm/alias", {
      method: "PUT", body: JSON.stringify({ tool, mappings: { alias: "model" } }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.setMitmAliasAll).not.toHaveBeenCalled();
  });
});
