// decolua/9router #5060: the Pi card must never overwrite a stored real key with the
// placeholder it sends when no key is selected.
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), copyFile: vi.fn(), chmod: vi.fn(), rename: vi.fn(), unlink: vi.fn(), realpath: vi.fn() }));
const db = vi.hoisted(() => ({
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getSyncedModelCatalog: vi.fn(),
  getCachedSharedModelMetadata: vi.fn(),
}));
const modelSvc = vi.hoisted(() => ({ getModelInfo: vi.fn() }));

vi.mock("fs/promises", () => ({ default: io }));
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: () => "/test-pi" } };
});
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/sse/services/model", async (importOriginal) => ({ ...await importOriginal(), ...modelSvc }));

import { POST } from "@/app/api/cli-tools/pi-settings/route.js";

const save = (body) => POST(new Request("http://localhost/api/cli-tools/pi-settings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseUrl: "http://localhost:20128", model: "cc/claude-opus", ...body }),
}));
const writtenKey = () => JSON.parse(io.writeFile.mock.calls[0][1]).providers.durindoor.apiKey;
const stored = (apiKey) => io.readFile.mockResolvedValue(JSON.stringify({ providers: { durindoor: { apiKey, models: [] } } }));

beforeEach(() => {
  vi.clearAllMocks();
  io.access.mockRejectedValue(new Error("missing"));
  io.readFile.mockResolvedValue("{}");
  io.realpath.mockImplementation(async (filePath) => filePath);
  io.writeFile.mockResolvedValue(undefined);
  io.mkdir.mockResolvedValue(undefined);
  io.copyFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  io.chmod.mockResolvedValue(undefined);
  io.rename.mockResolvedValue(undefined);
  io.unlink.mockResolvedValue(undefined);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getSyncedModelCatalog.mockResolvedValue(null);
  db.getCachedSharedModelMetadata.mockResolvedValue(null);
  modelSvc.getModelInfo.mockImplementation(async (id) => ({ provider: id.split("/")[0], model: id.split("/").slice(1).join("/") }));
});

describe("Pi settings key handling", () => {
  it.each(["sk_durindoor", "sk_9router", "", undefined])("keeps the stored key when the card sends %j", async (sent) => {
    stored("sk-stored");
    expect((await save({ apiKey: sent })).status).toBe(200);
    expect(writtenKey()).toBe("sk-stored");
  });

  it("writes an explicitly selected key", async () => {
    stored("sk-stored");
    await save({ apiKey: "sk-new" });
    expect(writtenKey()).toBe("sk-new");
  });

  it("falls back to the placeholder only when no real key exists anywhere", async () => {
    await save({ apiKey: "sk_durindoor" });
    expect(writtenKey()).toBe("sk_durindoor");
  });
});
