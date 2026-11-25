// Port of OmniRoute #924 (head a7fa34c2fcecfe71bdde16e935f4731d4fa803b1,
// merge 24721cf2fafae0ad735dcfa2863dcb9a44edd0f2): provider-scoped legacy
// GitHub Copilot Gemini Pro ids keep resolving to the current catalog model
// (`gemini-3.1-pro-preview`) without touching other providers, bare Gemini
// names, or canonical ids.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { getModelInfoCore } from "../../open-sse/services/model.js";

const CANONICAL = "gemini-3.1-pro-preview";

describe("OmniRoute #924 GitHub Gemini legacy aliases", () => {
  it.each([
    ["github/gemini-3-pro", "github"],
    ["gh/gemini-3-pro", "github"],
    ["github/gemini-3-pro-preview", "github"],
    ["gh/gemini-3-pro-preview", "github"]
  ])("resolves scoped legacy id %s to the canonical GitHub model", async (modelStr, provider) => {
    await expect(getModelInfoCore(modelStr, {})).resolves.toEqual({
      provider,
      model: CANONICAL
    });
  });

  it("keeps the canonical GitHub id untouched", async () => {
    await expect(getModelInfoCore("gh/gemini-3.1-pro-preview", {})).resolves.toEqual({
      provider: "github",
      model: CANONICAL
    });
  });

  it("leaves other providers' gemini-3-pro untouched", async () => {
    await expect(getModelInfoCore("gemini/gemini-3-pro", {})).resolves.toEqual({
      provider: "gemini",
      model: "gemini-3-pro"
    });
    await expect(getModelInfoCore("gemini-cli/gemini-3-pro-preview", {})).resolves.toEqual({
      provider: "gemini-cli",
      model: "gemini-3-pro-preview"
    });
  });

  it("leaves bare Gemini names on their inferred provider", async () => {
    await expect(getModelInfoCore("gemini-3-pro", {})).resolves.toEqual({
      provider: "gemini",
      model: "gemini-3-pro"
    });
  });

  it("keeps case-sensitive matching", async () => {
    await expect(getModelInfoCore("gh/GEMINI-3-PRO", {})).resolves.toEqual({
      provider: "github",
      model: "GEMINI-3-PRO"
    });
  });

  it("normalizes an operator alias that targets the GitHub provider", async () => {
    await expect(getModelInfoCore("my-gemini", { "my-gemini": "github/gemini-3-pro" })).resolves.toEqual({
      provider: "github",
      model: CANONICAL
    });
    await expect(getModelInfoCore("my-gemini", { "my-gemini": "gh/gemini-3-pro-preview" })).resolves.toEqual({
      provider: "github",
      model: CANONICAL
    });
  });

  it("keeps an operator alias bound to another provider unchanged", async () => {
    await expect(getModelInfoCore("my-gemini", { "my-gemini": "gemini/gemini-3-pro" })).resolves.toEqual({
      provider: "gemini",
      model: "gemini-3-pro"
    });
  });

  it("keeps a user-defined alias ahead of the provider-scoped mapping", async () => {
    await expect(getModelInfoCore("gemini-3-pro", { "gemini-3-pro": "gemini/gemini-3-pro" })).resolves.toEqual({
      provider: "gemini",
      model: "gemini-3-pro"
    });
  });
});

describe("OmniRoute #924 GitHub Gemini legacy aliases (gateway entry point)", () => {
  const originalDataDir = process.env.DATA_DIR;
  let cleanup = () => {};

  afterEach(() => {
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function loadGateway() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-github-gemini-alias-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    const { getModelInfo } = await import("../../src/sse/services/model.js");
    cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
    return getModelInfo;
  }

  it("routes a scoped legacy GitHub id to the canonical model", async () => {
    const getModelInfo = await loadGateway();
    await expect(getModelInfo("gh/gemini-3-pro")).resolves.toEqual({
      provider: "github",
      model: CANONICAL
    });
    await expect(getModelInfo("github/gemini-3-pro-preview")).resolves.toEqual({
      provider: "github",
      model: CANONICAL
    });
  });

  it("keeps non-GitHub routing unchanged", async () => {
    const getModelInfo = await loadGateway();
    await expect(getModelInfo("gemini/gemini-3-pro")).resolves.toEqual({
      provider: "gemini",
      model: "gemini-3-pro"
    });
    await expect(getModelInfo("gpt-4o-mini")).resolves.toEqual({
      provider: "openai",
      model: "gpt-4o-mini"
    });
  });
});
