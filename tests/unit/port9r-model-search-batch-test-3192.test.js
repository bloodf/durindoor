import { describe, it, expect, vi, beforeEach } from "vitest";

const repo = vi.hoisted(() => {
  const store = new Map();
  return {
    store,
    getModelTestResults: vi.fn(async () => Object.fromEntries(store)),
    saveModelTestResults: vi.fn(async (entries) => { for (const [k, v] of entries) store.set(k, v); }),
    clearModelTestResults: vi.fn(async (keys) => { for (const k of keys) store.delete(k); }),
  };
});
vi.mock("@/lib/db/repos/modelTestResultsRepo.js", () => repo);

import { GET, POST, DELETE } from "@/app/api/models/test-results/route.js";
import { matchesProviderSearch } from "@/app/(dashboard)/dashboard/providers/providerFilters.js";
import {
  createBatchResultCollector,
  modelTestResultKey,
  selectConnectionResults,
} from "@/shared/utils/modelTestResults.js";

const req = (method, body) => new Request("http://localhost/api/models/test-results", { method, body: JSON.stringify(body) });

beforeEach(() => { repo.store.clear(); vi.clearAllMocks(); });

describe("#3192 provider search by model", () => {
  const models = [{ id: "gpt-5", name: "GPT 5" }, { id: "o3" }, {}];
  it("matches a provider by registry model id, name or routed id", () => {
    expect(matchesProviderSearch("OpenAI", "gpt-5", "openai", models)).toBe(true);
    expect(matchesProviderSearch("Acme", "gpt 5", "acme", models)).toBe(true);
    expect(matchesProviderSearch("Acme", "acme/o3", "acme", models)).toBe(true);
    expect(matchesProviderSearch("Acme", "claude", "acme", models)).toBe(false);
    expect(matchesProviderSearch(undefined, "open")).toBe(false);
    expect(matchesProviderSearch(undefined, "  ")).toBe(true);
  });
});

describe("#3192 persisted model test results", () => {
  it("isolates results by connection and model", async () => {
    const a = modelTestResultKey("cx/gpt-5", "conn-a");
    const b = modelTestResultKey("cx/gpt-5", "conn-b");
    expect(a).not.toBe(b);
    expect((await POST(req("POST", { results: { [a]: { state: "ok" }, [b]: { state: "error", error: "401" } } }))).status).toBe(200);
    const { results } = await (await GET()).json();
    expect(selectConnectionResults(results, "conn-a")).toEqual({ "cx/gpt-5": expect.objectContaining({ state: "ok", error: null }) });
    expect(selectConnectionResults(results, "conn-b")["cx/gpt-5"]).toMatchObject({ state: "error", error: "401" });
    expect(selectConnectionResults(results, undefined)).toEqual({});
    expect((await DELETE(req("DELETE", { models: [a] }))).status).toBe(200);
    expect(repo.store.has(a)).toBe(false);
    expect(repo.store.has(b)).toBe(true);
  });

  it("rejects malformed payloads without writing", async () => {
    for (const body of [{}, { results: [] }, { results: { "no-model": { state: "ok" } } }, { results: { [modelTestResultKey("cx/m", "c")]: { state: "testing" } } }]) {
      expect((await POST(req("POST", body))).status).toBe(400);
    }
    expect((await DELETE(req("DELETE", { models: "x" }))).status).toBe(400);
    expect(repo.saveModelTestResults).not.toHaveBeenCalled();
  });

  it("keeps partial failures and drops events after cancellation", () => {
    const ctrl = new AbortController();
    const collector = createBatchResultCollector(ctrl.signal, "conn-a");
    expect(collector.accept("cx/m1", "ok")).toBe(true);
    expect(collector.accept("cx/m2", "error", "timeout")).toBe(true);
    ctrl.abort();
    expect(collector.accept("cx/m3", "ok")).toBe(false);
    expect(collector.results()).toEqual({
      [modelTestResultKey("cx/m1", "conn-a")]: { state: "ok", error: null },
      [modelTestResultKey("cx/m2", "conn-a")]: { state: "error", error: "timeout" },
    });
  });
});
