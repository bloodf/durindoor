// @vitest-environment happy-dom
// Upstream 9router #2364: two API keys that share a display name stay two keys
// in usage stats. The dashboard groups its API-key table by name.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disambiguateApiKeyNames } from "@/shared/utils/usageApiKeyNames.js";
import UsageStats from "@/shared/components/UsageStats.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({
  default: ({ value, onChange, options, ...props }) => React.createElement(
    "select",
    { ...props, value, onChange: (event) => onChange(event.target.value) },
    options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label)),
  ),
}));
vi.mock("@/app/(dashboard)/dashboard/usage/components/OverviewCards", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageChart", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/RequestsPanel", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/dashboard/usage/components/UsageTable", () => ({
  fmt: String,
  fmtTime: String,
  default: ({ groupedData }) => React.createElement(
    "ul",
    null,
    groupedData.map((group) => React.createElement(
      "li",
      { key: group.groupKey, "data-group": group.groupKey, "data-requests": group.summary.requests },
    )),
  ),
}));

const bucket = (keyName, apiKeyKey, rawModel = "model") => ({
  keyName, apiKeyKey, rawModel, requests: 1, promptTokens: 1, completionTokens: 1, cost: 0,
  lastUsed: "2026-11-25T00:00:00.000Z",
});

describe("port/upstream-2364: API keys that share a name stay distinct", () => {
  it("suffixes only the names that more than one key uses", () => {
    const input = {
      a1: bucket("Shared", "api-key:11111111-aaaa", "m1"),
      a2: bucket("Shared", "api-key:11111111-aaaa", "m2"),
      b: bucket("Shared", "api-key:22222222-bbbb"),
      solo: bucket("Solo", "api-key:33333333-cccc"),
    };
    const out = disambiguateApiKeyNames(input);

    expect(Object.values(out).map((row) => row.keyName))
      .toEqual(["Shared (11111111)", "Shared (11111111)", "Shared (22222222)", "Solo"]);
    expect(input.a1.keyName).toBe("Shared");
  });

  it("falls back to the whole identity when the short suffixes collide", () => {
    const out = disambiguateApiKeyNames({
      a: bucket("Imported", "api-key:key-import-1"),
      b: bucket("Imported", "api-key:key-import-2"),
    });

    expect(out.a.keyName).toBe("Imported (api-key:key-import-1)");
    expect(out.b.keyName).toBe("Imported (api-key:key-import-2)");
  });

  it("leaves rows without an identity unchanged", () => {
    const rows = { a: { keyName: "Old" }, b: { keyName: "Old" } };
    expect(disambiguateApiKeyNames(rows)).toEqual(rows);
    expect(disambiguateApiKeyNames(undefined)).toEqual({});
  });

  it("renders one dashboard group per key", async () => {
    const stats = {
      byModel: {}, byProvider: {}, byAccount: {}, byEndpoint: {},
      byApiKey: { a: bucket("Shared", "api-key:11111111-aaaa"), b: bucket("Shared", "api-key:22222222-bbbb") },
      pending: { byModel: {}, byAccount: {} }, activeRequests: [], activeSessions: [], recentRequests: [],
    };
    globalThis.EventSource = class { close() {} };
    globalThis.fetch = vi.fn((url) => Promise.resolve({
      ok: true, json: async () => (String(url).startsWith("/api/usage/stats") ? stats : {}),
    }));
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(UsageStats, { period: "7d", hidePeriodSelector: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      const select = container.querySelector("select");
      select.value = "apiKey";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const groups = [...container.querySelectorAll("li[data-group]")]
      .map((node) => [node.dataset.group, node.dataset.requests]);
    expect(groups.sort()).toEqual([["Shared (11111111)", "1"], ["Shared (22222222)", "1"]]);
    act(() => root.unmount());
  });

  describe("persisted stats", () => {
    const originalDataDir = process.env.DATA_DIR;
    let tempDir;
    let db;

    beforeAll(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-key-names-"));
      process.env.DATA_DIR = tempDir;
      vi.resetModules();
      db = await import("@/lib/db/index.js");
      await db.initDb();
    });

    afterAll(async () => {
      await disposeLoadedRequestDetailsRepo();
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
    });

    it("keeps same-name, same-prefix keys apart in every stats period", async () => {
      const keys = [
        await db.createApiKey("Shared name", "identity-machine"),
        await db.createApiKey("Shared name", "identity-machine"),
      ];
      expect(keys[0].key.slice(0, 8)).toBe(keys[1].key.slice(0, 8));
      for (const apiKey of keys) {
        await db.saveRequestUsage({
          provider: "identity-test", model: "same-model", apiKey: apiKey.key,
          tokens: { prompt_tokens: 10, completion_tokens: 1 }, endpoint: "/v1/responses", status: "ok",
        });
      }

      for (const period of ["today", "24h", "7d", "30d", "60d", "all"]) {
        const { byApiKey } = await db.getUsageStats(period);
        const rows = Object.values(disambiguateApiKeyNames(byApiKey))
          .filter((row) => row.provider === "identity-test");

        expect(rows.map((row) => row.requests), period).toEqual([1, 1]);
        expect(rows.map((row) => row.keyName).sort(), period)
          .toEqual(keys.map((key) => `Shared name (${key.id.slice(0, 8)})`).sort());
        for (const apiKey of keys) expect(JSON.stringify(byApiKey), period).not.toContain(apiKey.key);
      }
    });
  });
});
