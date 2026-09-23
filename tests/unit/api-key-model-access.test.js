import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let access;
let policy;
let helper;

function request(apiKey) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

async function keyWith(modelAccess) {
  return db.createApiKey(`access-${Math.random()}`, "machine-1", [], null, null, { policy: { modelAccess } });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-api-key-access-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  access = await import("../../src/sse/services/modelAccess.js");
  policy = await import("../../src/sse/services/apiKeyPolicy.js");
  helper = await import("@/lib/db/helpers/apiKeyPolicy.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("model access patterns", () => {
  it("matches globs case-insensitively, with * spanning slashes and metacharacters escaped", () => {
    expect(access.matchesModelPattern("openai/*", "OpenAI/gpt-4o")).toBe(true);
    expect(access.matchesModelPattern("*", "openrouter/meta/llama")).toBe(true);
    expect(access.matchesModelPattern("claude-*-sonnet", "claude-4.5-sonnet")).toBe(true);
    expect(access.matchesModelPattern("gpt-4.1", "gpt-4x1")).toBe(false);
    expect(access.matchesModelPattern("openai/gpt-4o", "openai/gpt-4o-mini")).toBe(false);
  });

  it("evaluates allow and deny rules over every candidate name", () => {
    const allow = { mode: "allow", patterns: ["cx/*"] };
    const deny = { mode: "deny", patterns: ["cx/*"] };
    expect(access.isModelAccessAllowed(allow, ["codex/gpt-5", "cx/gpt-5"])).toBe(true);
    expect(access.isModelAccessAllowed(allow, ["openai/gpt-4o"])).toBe(false);
    expect(access.isModelAccessAllowed(deny, ["codex/gpt-5", "cx/gpt-5"])).toBe(false);
    expect(access.isModelAccessAllowed(deny, ["openai/gpt-4o"])).toBe(true);
    expect(access.isModelAccessAllowed({ mode: "allow", patterns: [] }, ["openai/gpt-4o"])).toBe(false);
    expect(access.isModelAccessAllowed(undefined, ["anything"])).toBe(true);
  });

  it("lists a resolved model under its provider id and its alias", async () => {
    const candidatesFor = await access.getModelAccessCandidateBuilder();
    expect(candidatesFor("codex/gpt-5")).toEqual(expect.arrayContaining(["codex/gpt-5", "cx/gpt-5"]));
    expect(candidatesFor("cx/gpt-5")).toEqual(expect.arrayContaining(["codex/gpt-5", "cx/gpt-5"]));
  });
});

describe("model access policy storage", () => {
  it("normalizes the rule and rejects malformed input", () => {
    expect(helper.normalizeApiKeyPolicy({ modelAccess: { mode: "deny", patterns: [" openai/* ", "OPENAI/*", ""] } }))
      .toEqual({ modelAccess: { mode: "deny", patterns: ["openai/*"] } });
    expect(helper.normalizeApiKeyPolicy({ modelAccess: null })).toEqual({ modelAccess: { mode: "all", patterns: [] } });
    expect(() => helper.normalizeApiKeyPolicy({ modelAccess: { mode: "block", patterns: [] } })).toThrow(/modelAccess.mode/);
    expect(() => helper.normalizeApiKeyPolicy({ modelAccess: { mode: "allow", patterns: "openai/*" } })).toThrow(/patterns/);
    const tooMany = Array.from({ length: 201 }, (_, i) => `m${i}`);
    expect(() => helper.normalizeApiKeyPolicy({ modelAccess: { mode: "allow", patterns: tooMany } })).toThrow(/at most 200/);
  });
});

describe("model access enforcement", () => {
  it("returns 403 for a denied model under any of its names", async () => {
    const key = await keyWith({ mode: "deny", patterns: ["cx/*"] });
    const byId = await policy.enforceApiKeyModelPolicy(request(key.key), "codex/gpt-5", key.key);
    expect(byId.status).toBe(403);
    expect((await byId.json()).error.message).toMatch(/not allowed for this API key/);
    expect(await policy.enforceApiKeyModelPolicy(request(key.key), "openai/gpt-4o", key.key)).toBeNull();
  });

  it("only lets an allowlisted key through to matching models", async () => {
    const key = await keyWith({ mode: "allow", patterns: ["openai/gpt-4o*"] });
    expect(await policy.enforceApiKeyModelPolicy(request(key.key), "openai/gpt-4o-mini", key.key)).toBeNull();
    expect((await policy.enforceApiKeyModelPolicy(request(key.key), "anthropic/claude-x", key.key)).status).toBe(403);
  });

  it("leaves requests without a key unrestricted", async () => {
    const anonymous = new Request("http://localhost/v1/chat/completions", { method: "POST" });
    expect(await policy.enforceApiKeyModelPolicy(anonymous, "anthropic/claude-x", null)).toBeNull();
  });

  it("filters /v1/models entries for the calling key", async () => {
    const key = await keyWith({ mode: "deny", patterns: ["openai/*"] });
    const models = [{ id: "openai/gpt-4o" }, { id: "cx/gpt-5" }, { id: "my-combo" }];
    expect(await access.filterModelsForRequest(request(key.key), models)).toEqual([{ id: "cx/gpt-5" }, { id: "my-combo" }]);
    const anonymous = new Request("http://localhost/v1/models");
    expect(await access.filterModelsForRequest(anonymous, models)).toBe(models);
  });
});
