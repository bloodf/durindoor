import { describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ readFile: vi.fn(), mkdir: vi.fn(), write: vi.fn() }));
vi.mock("fs/promises", () => ({ default: { readFile: io.readFile, mkdir: io.mkdir } }));
vi.mock("@/lib/cliTools/readExistingConfig", () => ({ writeConfigAtomic: io.write }));
vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));

const { POST, DELETE } = await import("../../src/app/api/cli-tools/hermes-settings/route.js");
const after = "# Next section\nkanban:\n  enabled: true\n";
const yaml = "model:\n  provider: old\n# Credentials\n\n  api_key: old-secret\n" + after;

describe("Hermes model blocks with comments", () => {
  it("replaces all model fields and preserves the following section", async () => {
    io.readFile.mockResolvedValue(yaml);
    const result = await POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ baseUrl: "http://localhost:3000", model: "new-model" }),
    }));
    expect(result.status).toBe(200);
    expect(io.write.mock.lastCall[1]).toBe('model:\n  default: "new-model"\n  provider: "custom"\n  base_url: "http://localhost:3000/v1"\n  api_key: ${OPENAI_API_KEY}\n' + after);
  });

  it("removes the full model block with CRLF line endings", async () => {
    io.readFile.mockResolvedValue(yaml.replaceAll("\n", "\r\n"));
    expect((await DELETE()).status).toBe(200);
    expect(io.write.mock.lastCall[1]).toBe(after.replaceAll("\n", "\r\n"));
  });
});
