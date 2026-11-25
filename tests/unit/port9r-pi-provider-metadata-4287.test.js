// Port of upstream 9router #4287. The merge by id itself landed with #4278.
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

describe("upstream 9router #4287: Pi provider metadata and model limits", () => {
  const savedProvider = (extra) => io.readFile.mockResolvedValue(JSON.stringify({
    providers: { durindoor: { baseUrl: "http://old/v1", apiKey: "sk-saved", ...extra } },
  }));

  it("keeps the api style saved on the provider entry", async () => {
    savedProvider({ api: "openai-responses", models: [] });

    await save({ models: ["openai/gpt-a"] });

    expect(written().providers.durindoor.api).toBe("openai-responses");
  });

  it("defaults a new provider entry to openai-completions", async () => {
    await save({ models: ["openai/gpt-a"] });

    expect(written().providers.durindoor.api).toBe("openai-completions");
  });

  it("keeps saved snake_case limits instead of replacing them with defaults", async () => {
    savedProvider({ models: [{ id: "openai/gpt-a", context_window: 555000, max_tokens: 4321 }] });

    await save({ models: ["openai/gpt-a"] });

    expect(models()[0]).toMatchObject({ contextWindow: 555000, maxTokens: 4321 });
  });

  it("lets supplied snake_case limits replace saved ones", async () => {
    savedProvider({ models: [{ id: "openai/gpt-a", contextWindow: 555000, maxTokens: 4321 }] });

    await save({ models: [{ id: "openai/gpt-a", context_window: 666000, max_tokens: 1234 }] });

    expect(models()[0]).toMatchObject({ contextWindow: 666000, maxTokens: 1234 });
  });
});
