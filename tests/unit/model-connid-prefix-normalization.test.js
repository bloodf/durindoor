// Port of OmniRoute #6890 — a custom compatible node addressed by its raw
// internal connection id (`<connId>/<modelStr>`) must resolve to the same raw
// model id as the bare alias form (`<prefix>/<modelStr>`), even when the
// caller naively concatenated `owned_by` (the node prefix) with the listed
// model id. Double-namespaced ids 400 upstream.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

const CONN_ID = "openai-compatible-chat-6890";
const ANTHROPIC_CONN_ID = "anthropic-compatible-chat-6890";
const PREFIX = "fta";
const RAW_MODEL_ID = "vova/gpt-5.5"; // upstream's own model id already has a slash

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-model-connid-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderNode } = await import("@/models/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    createProviderNode,
    getModelInfo,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("connId-addressed custom node prefix normalization (#6890)", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("resolves bare alias form `<prefix>/<rawModelId>` to the raw model id", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.createProviderNode({
      id: CONN_ID,
      type: "openai-compatible",
      name: "freetheai (probe)",
      prefix: PREFIX,
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo(`${PREFIX}/${RAW_MODEL_ID}`)).resolves.toEqual({
      provider: CONN_ID,
      model: RAW_MODEL_ID,
    });
  });

  it("resolves `<connId>/<rawModelId>` (no namespace) to the raw model id", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.createProviderNode({
      id: CONN_ID,
      type: "openai-compatible",
      name: "freetheai (probe)",
      prefix: PREFIX,
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo(`${CONN_ID}/${RAW_MODEL_ID}`)).resolves.toEqual({
      provider: CONN_ID,
      model: RAW_MODEL_ID,
    });
  });

  it("strips redundant node prefix from `<connId>/<prefix>/<rawModelId>` (naive owned_by+id concat)", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.createProviderNode({
      id: CONN_ID,
      type: "openai-compatible",
      name: "freetheai (probe)",
      prefix: PREFIX,
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo(`${CONN_ID}/${PREFIX}/${RAW_MODEL_ID}`)).resolves.toEqual({
      provider: CONN_ID,
      model: RAW_MODEL_ID,
    });
  });

  it("applies the same normalization to anthropic-compatible nodes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.createProviderNode({
      id: ANTHROPIC_CONN_ID,
      type: "anthropic-compatible",
      name: "anthropic probe",
      prefix: PREFIX,
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(
      ctx.getModelInfo(`${ANTHROPIC_CONN_ID}/${PREFIX}/${RAW_MODEL_ID}`),
    ).resolves.toEqual({
      provider: ANTHROPIC_CONN_ID,
      model: RAW_MODEL_ID,
    });
  });

  it("keeps a model id that merely shares a prefix segment but is not the node prefix", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.createProviderNode({
      id: CONN_ID,
      type: "openai-compatible",
      name: "freetheai (probe)",
      prefix: PREFIX,
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    // `fta-x/...` starts with "fta" but not "fta/" — must NOT be stripped.
    await expect(ctx.getModelInfo(`${CONN_ID}/fta-x/model`)).resolves.toEqual({
      provider: CONN_ID,
      model: "fta-x/model",
    });
  });
});
