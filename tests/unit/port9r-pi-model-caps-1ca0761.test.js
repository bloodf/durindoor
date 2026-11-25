import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ access: vi.fn(), realpath: vi.fn(), readlink: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), copyFile: vi.fn(), rename: vi.fn(), unlink: vi.fn(), mkdir: vi.fn() }));
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
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => Response.json(body, init) },
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/sse/services/model", async (importOriginal) => ({
  ...await importOriginal(),
  ...modelSvc,
}));

import { POST } from "@/app/api/cli-tools/pi-settings/route.js";

const save = (body) => POST(new Request("http://localhost/api/cli-tools/pi-settings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseUrl: "http://localhost:20128", ...body }),
}));
const written = () => JSON.parse(io.writeFile.mock.calls[0][1]);
const models = () => written().providers.durindoor.models;

beforeEach(() => {
  vi.clearAllMocks();
  io.access.mockRejectedValue(new Error("missing"));
  io.realpath.mockImplementation(async (path) => path);
  io.readlink.mockRejectedValue(Object.assign(new Error("not a link"), { code: "EINVAL" }));
  io.readFile.mockResolvedValue("{}");
  io.writeFile.mockResolvedValue(undefined);
  io.copyFile.mockRejectedValue({ code: "ENOENT" });
  io.rename.mockResolvedValue();
  io.unlink.mockResolvedValue();
  io.mkdir.mockResolvedValue(undefined);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getSyncedModelCatalog.mockResolvedValue(null);
  db.getCachedSharedModelMetadata.mockResolvedValue(null);
  modelSvc.getModelInfo.mockImplementation(async (id) => {
    const [provider, ...rest] = id.split("/");
    return { provider, model: rest.join("/") || id };
  });
});

// Port of upstream 9router 1ca076167e: Pi model entries carry input, reasoning and thinking levels.
describe("Pi model caps (port9r 1ca0761)", () => {
  it("seeds a new reasoning vision model with input, reasoning and a full level map", async () => {
    await save({ models: ["antigravity/claude-opus-5-5"] });
    const [entry] = models();
    expect(entry.input).toEqual(["text", "image"]);
    expect(entry.reasoning).toBe(true);
    expect(entry.thinkingLevelMap).toEqual({ off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: "max" });
  });

  it("seeds a model that cannot reason without a level map, never null", async () => {
    await save({ models: ["openai/gpt-4o-mini"] });
    const [entry] = models();
    expect(entry.reasoning).toBe(false);
    expect(entry).not.toHaveProperty("thinkingLevelMap");
  });

  it("keeps a saved entry's hand-written caps and drops schema-invalid values", async () => {
    io.access.mockImplementation(async (p) => (String(p).endsWith("agent/models.json") ? undefined : Promise.reject(new Error("missing"))));
    io.readFile.mockResolvedValue(JSON.stringify({ providers: { durindoor: { baseUrl: "x", models: [
      { id: "a/b", contextWindow: 200000, maxTokens: 64000, input: ["text", "audio"], reasoning: true, thinkingLevelMap: { high: "high", bogus: "x", max: 5 } },
      { id: "c/d", contextWindow: 200000, maxTokens: 64000, reasoning: false, thinkingLevelMap: { high: "high" } },
    ] } } }));
    await save({ models: ["a/b", "c/d"] });
    const [ab, cd] = models();
    expect(ab.input).toEqual(["text"]);
    expect(ab.thinkingLevelMap).toEqual({ high: "high" });
    expect(cd.reasoning).toBe(false);
    expect(cd).not.toHaveProperty("thinkingLevelMap");
  });
});
