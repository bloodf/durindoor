// @vitest-environment happy-dom
// Port of decolua/9router#5314: live Recent Requests rows carry cache-read
// tokens and the panel shows a Cache column with the hit rate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cache-rate-"));
  process.env.DATA_DIR = tempDir;
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._recentRing;
  db = await import("@/lib/db/index.js");
  await db.initDb();
}, 120_000);

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("recent requests cache tokens (#5314)", () => {
  it("getActiveRequests exposes cachedTokens per recent request", async () => {
    await db.saveRequestUsage({
      provider: "claude", model: "claude-sonnet-5-5", endpoint: "/v1/messages", status: "ok",
      tokens: { prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 900 },
    });
    const { recentRequests } = await db.getActiveRequests();
    const row = recentRequests.find((r) => r.model === "claude-sonnet-5-5");
    expect(row.cachedTokens).toBe(900);
    expect(row.promptTokens).toBe(1000);
  });

  it("RequestsPanel renders cache tokens and hit rate", { timeout: 60_000 }, async () => {
    const { default: RequestsPanel, cacheHitRate } = await import("@/app/(dashboard)/dashboard/usage/components/RequestsPanel.jsx");
    expect(cacheHitRate({ cachedTokens: 900, promptTokens: 1000 })).toBe(90);
    expect(cacheHitRate({ cachedTokens: 2000, promptTokens: 1000 })).toBe(100);
    expect(cacheHitRate({ cachedTokens: 0, promptTokens: 1000 })).toBe(0);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(React.createElement(RequestsPanel, {
      recentRequests: [{ requestId: "a", model: "m1", status: "ok", promptTokens: 1000, completionTokens: 5, cachedTokens: 900 },
        { requestId: "b", model: "m2", status: "ok", promptTokens: 10, completionTokens: 5, cachedTokens: 0 }],
    })));
    expect(container.textContent).toContain("Cache");
    expect(container.textContent).toContain("90%");
    await act(async () => root.unmount());
    container.remove();
  });
});
