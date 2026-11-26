import { afterAll, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ connections: vi.fn(), combo: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.connections, getComboForModel: mocks.combo, getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
const { PROVIDER_MODELS } = await import("../../open-sse/providers/index.js");
const { getComboModels } = await import("../../src/sse/services/model.js");
const { isDevinBinAvailable } = await import("../../open-sse/executors/devin-acp-stdio.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devin-readiness-"));
const original = { bin: process.env.CLI_DEVIN_BIN, path: process.env.PATH, cli: PROVIDER_MODELS["devin-cli"], agentic: PROVIDER_MODELS.dva };
afterAll(() => {
  if (original.bin === undefined) delete process.env.CLI_DEVIN_BIN; else process.env.CLI_DEVIN_BIN = original.bin;
  process.env.PATH = original.path;
  if (original.cli === undefined) delete PROVIDER_MODELS["devin-cli"]; else PROVIDER_MODELS["devin-cli"] = original.cli;
  PROVIDER_MODELS.dva = original.agentic;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("filters both local Devin identities only from auto candidates and preserves fallback", async () => {
  // Synthetic family entries exercise the real catalog builder with local IDs.
  PROVIDER_MODELS["devin-cli"] = [{ id: "glm-cli" }];
  PROVIDER_MODELS.dva = [{ id: "glm-agentic" }];
  const connections = [{ provider: "devin-cli", isActive: true, apiKey: "fixture" }, { provider: "devin-cli-agentic", isActive: true }, { provider: "glm", isActive: true }];
  mocks.connections.mockResolvedValue(connections);
  mocks.combo.mockResolvedValue({ models: ["dva/glm-agentic", "devin-cli/glm-cli"] });
  process.env.CLI_DEVIN_BIN = path.join(dir, "devin");
  const before = structuredClone(connections);
  let pool = await getComboModels("auto/glm");
  expect(pool).not.toContain("devin-cli/glm-cli");
  expect(pool).not.toContain("dva/glm-agentic");
  expect(pool.some((member) => member.startsWith("glm/"))).toBe(true);
  expect(await getComboModels("saved")).toEqual(["dva/glm-agentic", "devin-cli/glm-cli"]);
  expect(connections).toEqual(before);
  fs.writeFileSync(process.env.CLI_DEVIN_BIN, "fixture", { mode: 0o644 });
  expect(isDevinBinAvailable()).toBe(false);
  fs.chmodSync(process.env.CLI_DEVIN_BIN, 0o755);
  pool = await getComboModels("auto/glm");
  expect(pool).toContain("devin-cli/glm-cli");
  if (process.platform !== "win32") expect(pool).toContain("dva/glm-agentic");
  delete process.env.CLI_DEVIN_BIN;
  process.env.PATH = dir;
  expect(isDevinBinAvailable()).toBe(true);
  expect(isDevinBinAvailable({ agentic: true })).toBe(false);
});
