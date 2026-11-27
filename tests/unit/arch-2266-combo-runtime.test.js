import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_JOB_HEADER,
  comboConversationAffinity,
  getComboModelQuotaHealth,
  getRotatedModels,
  getWeightedModels,
  handleComboChat,
  planComboRequest,
  resetComboRotation,
  resetComboScoring,
} from "../../open-sse/services/combo.js";
import {
  CONVERSATION_AFFINITY_TTL_MS,
  MAX_CONVERSATION_AFFINITY_ENTRIES,
} from "../../open-sse/services/combo/affinity.js";
import { getComboRuntimeState } from "../../open-sse/services/combo/runtimeState.js";

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const json = (status, payload, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json", ...headers },
});
const ok = (model) => json(200, { choices: [{ message: { role: "assistant", content: `from ${model}` } }] });
const failed = (status) => json(status, { error: { message: `upstream ${status}` } });

beforeEach(() => {
  resetComboRotation();
  resetComboScoring();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetComboRotation();
  resetComboScoring();
});

describe("process-local runtime state across duplicated module copies", () => {
  it("shares rotation, weighted, affinity and scoring state, and a copy's reset clears the original", async () => {
    const roundRobin = () => getRotatedModels(["a", "b", "c"], "rr", "round-robin");
    expect(roundRobin()[0]).toBe("a");
    getRotatedModels(["a", "b"], "sticky", "round-robin", 2, "conv-1", [], "key-1");
    getRotatedModels(["a", "b"], "wrr", "round-robin", 1, null, [{ id: "a", weight: 3 }, { id: "b", weight: 1 }]);
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel: async (_b, model) => (model === "p/a" ? failed(429) : ok(model)),
      log,
      comboName: "scored",
      comboStrategy: "smart-scoring",
    });
    expect(getComboModelQuotaHealth("scored", "p/a")).toBe("degraded");

    vi.resetModules();
    const copy = await import("../../open-sse/services/combo.js");
    const copyState = (await import("../../open-sse/services/combo/runtimeState.js")).getComboRuntimeState();
    expect(copy.handleComboChat).not.toBe(handleComboChat);
    expect(copyState).toBe(getComboRuntimeState());
    expect(copy.comboConversationAffinity).toBe(comboConversationAffinity);

    // The copy continues the original's pointer instead of starting over.
    expect(copy.getRotatedModels(["a", "b", "c"], "rr", "round-robin")[0]).toBe("b");
    expect(copy.getComboModelQuotaHealth("scored", "p/a")).toBe("degraded");

    copy.resetComboRotation("rr");
    expect(roundRobin()[0]).toBe("a");
    expect(comboConversationAffinity.size).toBe(1);

    copy.resetComboRotation();
    copy.resetComboScoring();
    const state = getComboRuntimeState();
    expect(state.rotation.size).toBe(0);
    expect(state.weightedRotation.size).toBe(0);
    expect(state.affinity.size).toBe(0);
    expect(state.affinityScopes.size).toBe(0);
    expect(getComboModelQuotaHealth("scored", "p/a")).toBe("healthy");
  });

  it("adds fields a copy from an older module version lacks without replacing the shared object", async () => {
    const state = getComboRuntimeState();
    const scopes = state.affinityScopes;
    delete state.affinityScopes;
    vi.resetModules();
    const { getComboRuntimeState: copyGet } = await import("../../open-sse/services/combo/runtimeState.js");
    expect(copyGet()).toBe(state);
    expect(state.affinityScopes).toBeInstanceOf(Map);
    state.affinityScopes = scopes;
  });
});

describe("deterministic weighted and affinity planning", () => {
  it("orders Efraimidis-Spirakis picks from the injected random source and keeps weight-0 members last", () => {
    const members = [{ id: "a", weight: 1 }, { id: "b", weight: 0 }, { id: "c", weight: 4 }];
    const draws = [0.9, 0.1, 0.5];
    let i = 0;
    // keys: a = 0.9, c = 0.5^(1/4) ≈ 0.84, b = weight 0
    expect(getWeightedModels(["a", "b", "c"], members, () => draws[i++])).toEqual(["a", "c", "b"]);
  });

  it("plans smooth weighted round-robin 3:1 as a, a, b, a and skips the quota ranker", async () => {
    const quotaRanker = vi.fn(async (models) => [...models].reverse());
    const heads = [];
    for (let i = 0; i < 4; i++) {
      const plan = await planComboRequest({
        body: { messages: [{ role: "user", content: `turn ${i}` }] },
        models: ["a", "b"],
        log,
        comboName: "wrr-plan",
        comboStrategy: "round-robin",
        comboMembers: [{ id: "a", weight: 3 }, { id: "b", weight: 1 }],
        quotaRanker,
      });
      expect(plan.ok).toBe(true);
      expect(plan.models).toHaveLength(2);
      heads.push(plan.models[0]);
    }
    expect(heads).toEqual(["a", "a", "b", "a"]);
    expect(quotaRanker).not.toHaveBeenCalled();
  });

  it("keeps a sticky conversation on its pinned member while new conversations rotate", async () => {
    const plan = (content) => planComboRequest({
      body: { messages: [{ role: "user", content }] },
      models: ["a", "b", "c"],
      log,
      comboName: "affinity-plan",
      comboStrategy: "round-robin",
      comboStickyLimit: 2,
      apiKeyId: "caller",
    });
    const first = await plan("conversation one");
    expect(first.models).toEqual(["a", "b", "c"]);
    expect(first.conversationCacheKey).toBeTruthy();
    expect((await plan("conversation two")).models[0]).toBe("a"); // sticky limit 2 keeps a
    expect((await plan("conversation three")).models[0]).toBe("b");
    expect((await plan("conversation one")).models[0]).toBe("a");
    expect((await plan("conversation three")).models[0]).toBe("b");
  });

  it("filters ineligible members before rotation and returns local plan errors", async () => {
    const empty = await planComboRequest({ body: {}, models: [], log, comboName: "none" });
    expect(empty.ok).toBe(false);
    expect(empty.response.status).toBe(503);

    const rotated = [];
    for (let i = 0; i < 3; i++) {
      const plan = await planComboRequest({
        body: { messages: [{ role: "user", content: "x" }] },
        models: ["a", "b"],
        log,
        comboName: "eligibility",
        comboStrategy: "round-robin",
      });
      rotated.push(plan.models[0]);
    }
    expect(rotated).toEqual(["a", "b", "a"]);
  });
});

describe("conversation affinity expiry and bounded eviction", () => {
  const pin = (id, scope = "caller") => getRotatedModels(["a", "b"], "bounded", "round-robin", 2, id, [], scope);

  it("drops an expired pin on lookup and re-plans the conversation from the pointer", () => {
    vi.useFakeTimers();
    expect(pin("old")[0]).toBe("a");
    pin("other");
    vi.advanceTimersByTime(CONVERSATION_AFFINITY_TTL_MS + 1);
    expect(pin("old")[0]).toBe("b");
    expect(comboConversationAffinity.get('bounded:old:key:"caller"').index).toBe(1);
  });

  it("trims expired pins at the front of the scope on insert even below the cap", () => {
    vi.useFakeTimers();
    pin("stale-1");
    pin("stale-2");
    vi.advanceTimersByTime(CONVERSATION_AFFINITY_TTL_MS + 1);
    pin("fresh");
    expect([...comboConversationAffinity.keys()]).toEqual(['bounded:fresh:key:"caller"']);
  });

  it("evicts in constant work per insert at the cap and keeps other scopes intact", () => {
    pin("other-scope", "neighbour");
    for (let i = 0; i < MAX_CONVERSATION_AFFINITY_ENTRIES; i++) pin(`c-${i}`);
    pin("c-0"); // refresh moves c-0 to the most recently used end

    const iterate = vi.spyOn(comboConversationAffinity, Symbol.iterator);
    const keys = vi.spyOn(comboConversationAffinity, "keys");
    const get = vi.spyOn(comboConversationAffinity, "get");
    for (let i = 0; i < 500; i++) pin(`overflow-${i}`);
    expect(iterate).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
    // A fixed handful of lookups per insert (5 today), never a walk of the 1000 pins.
    expect(get.mock.calls.length).toBeLessThanOrEqual(500 * 6);

    expect(comboConversationAffinity.size).toBe(MAX_CONVERSATION_AFFINITY_ENTRIES + 1);
    expect(comboConversationAffinity.has('bounded:c-0:key:"caller"')).toBe(true);
    expect(comboConversationAffinity.has('bounded:c-1:key:"caller"')).toBe(false);
    expect(comboConversationAffinity.has('bounded:c-500:key:"caller"')).toBe(false);
    expect(comboConversationAffinity.has('bounded:c-501:key:"caller"')).toBe(true);
    expect(comboConversationAffinity.has('bounded:other-scope:key:"neighbour"')).toBe(true);
    expect(getComboRuntimeState().affinityScopes.get("caller").size).toBe(MAX_CONVERSATION_AFFINITY_ENTRIES);
  });

  it("resetComboRotation(name) removes only that combo's pins and their scope index entries", () => {
    pin("keep-me");
    getRotatedModels(["a", "b"], "other-combo", "round-robin", 2, "x", [], "caller");
    resetComboRotation("bounded");
    expect([...comboConversationAffinity.keys()]).toEqual(['other-combo:x:key:"caller"']);
    expect([...getComboRuntimeState().affinityScopes.get("caller")]).toEqual(['other-combo:x:key:"caller"']);
  });
});

describe("cancellation", () => {
  it("answers 499 before planning, so an aborted request does not advance rotation", async () => {
    const controller = new AbortController();
    controller.abort();
    const handleSingleModel = vi.fn();
    const res = await handleComboChat({
      body: {}, models: ["a", "b"], handleSingleModel, log, comboName: "cancel", comboStrategy: "round-robin", signal: controller.signal,
    });
    expect(res.status).toBe(499);
    expect(handleSingleModel).not.toHaveBeenCalled();
    expect(getRotatedModels(["a", "b"], "cancel", "round-robin")[0]).toBe("a");
  });

  it("stops before the first dispatch when the client aborts while a ranker is pending", async () => {
    const controller = new AbortController();
    const handleSingleModel = vi.fn(async (_b, model) => ok(model));
    const res = await handleComboChat({
      body: {}, models: ["a", "b"], handleSingleModel, log, comboName: "cancel-rank", comboStrategy: "fallback",
      signal: controller.signal,
      quotaRanker: async (models) => { controller.abort(); return models; },
    });
    expect(res.status).toBe(499);
    expect(handleSingleModel).not.toHaveBeenCalled();
  });

  it("does not fall back to the next member after an abort during an attempt", async () => {
    const controller = new AbortController();
    const handleSingleModel = vi.fn(async () => {
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const res = await handleComboChat({
      body: {}, models: ["a", "b"], handleSingleModel, log, comboName: "cancel-mid", comboStrategy: "fallback", signal: controller.signal,
    });
    expect(res.status).toBe(499);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });
});

describe("terminal behavior is unchanged", () => {
  const body = { messages: [{ role: "user", content: "accepted job conversation" }] };

  it("returns an accepted-job failure without replaying it on another member and releases the sticky pin", async () => {
    const handleSingleModel = vi.fn(async () => json(502, { error: { message: "job failed" } }, { [ACCEPTED_JOB_HEADER]: "job-1" }));
    const res = await handleComboChat({
      body, models: ["p/a", "p/b"], handleSingleModel, log, comboName: "accepted", comboStrategy: "round-robin", comboStickyLimit: 2, apiKeyId: "k",
    });
    expect(res.status).toBe(502);
    expect(res.headers.get(ACCEPTED_JOB_HEADER)).toBe("job-1");
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect([...comboConversationAffinity.keys()].filter((key) => key.startsWith("accepted:"))).toEqual([]);
  });

  it("moves the round-robin pointer past a served fallback member", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (_b, model) => { seen.push(model); return model === "a" ? failed(503) : ok(model); });
    const run = () => handleComboChat({ body: {}, models: ["a", "b", "c"], handleSingleModel, log, comboName: "served", comboStrategy: "round-robin" });
    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(200);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(getRotatedModels(["a", "b", "c"], "served", "round-robin")[0]).toBe("a");
  });
});
