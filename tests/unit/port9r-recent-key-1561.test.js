import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const oldDataDir = process.env.DATA_DIR;
let dir, repo, keys, gateway;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "recent-key-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  delete global._recentRing;
  vi.resetModules();
  await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/usageRepo.js");
  keys = await import("@/lib/db/repos/apiKeysRepo.js");
  gateway = await import("@/lib/db/repos/mcpGatewayRepo.js");
});
afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._recentRing;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(dir, { recursive: true, force: true });
});
it("identifies recent keys in stats, live monitoring and the usage stream without disclosing secrets", async () => {
  const one = await keys.createApiKey("First", "machine");
  const two = await keys.createApiKey("Second", "machine");
  const deleted = await keys.createApiKey("Removed", "machine");
  const mcp = await gateway.createGatewayKey("Gateway", "machine");
  const entries = [
    [one.key, "openai"], [two.key, "openai"], [deleted.key, "openai"],
    [mcp.key, "mcp-gateway"], [null, "openai"],
  ];
  for (const [index, [apiKey, provider]] of entries.entries()) {
    await repo.saveRequestUsage({ apiKey, provider, model: "model", timestamp: new Date().toISOString(), usageEventId: `event-${index}`, tokens: { prompt_tokens: 2, completion_tokens: 3 } });
  }
  await keys.deleteApiKey(deleted.id);
  const stats = await repo.getUsageStats();
  const live = await repo.getActiveRequests();
  for (const result of [stats, live]) {
    expect(result.recentRequests).toHaveLength(5);
    expect(result.recentRequests.map((row) => row.keyName)).toEqual(expect.arrayContaining(["First", "Second", "Gateway", "Local (No API Key)", "Deleted API key 1"]));
    expect(new Set(result.recentRequests.map((row) => row.apiKeyId)).size).toBe(5);
    for (const secret of entries.map(([key]) => key).filter(Boolean)) expect(JSON.stringify(result)).not.toContain(secret);
  }
  const { GET } = await import("@/app/api/usage/stream/route.js");
  const abort = new AbortController();
  const response = await GET(new Request("http://localhost/api/usage/stream?period=all", { signal: abort.signal }));
  const reader = response.body.getReader();
  const chunk = new TextDecoder().decode((await reader.read()).value);
  abort.abort();
  await reader.cancel();
  expect(chunk).toContain("First");
  for (const secret of entries.map(([key]) => key).filter(Boolean)) expect(chunk).not.toContain(secret);
});
