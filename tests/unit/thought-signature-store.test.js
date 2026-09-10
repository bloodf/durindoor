// Unit tests for open-sse/services/thoughtSignatureStore.js (upstream c08efdbe).
//
// The store keeps an in-memory LRU Map (cap 2000, 1h TTL) in front of the
// SQLite `kv` table (scope "gemini_thought_signatures", 7d TTL). Writes go to
// both a session-namespaced key (`sessionId:toolCallId`) and a bare
// `toolCallId` fallback key; sync reads are RAM-only. SQLite access is
// fail-open, so these tests exercise the memory layer without a database.
import { describe, expect, it } from "vitest";
import {
  storeGeminiThoughtSignature,
  getGeminiThoughtSignature,
  getGeminiThoughtSignatureSync,
} from "../../open-sse/services/thoughtSignatureStore.js";

// Module-level store state is shared within this file; prefix every key with
// a per-test tag so cases never collide.
let seq = 0;
const tag = () => `tss_${++seq}_${Date.now()}`;

describe("thoughtSignatureStore (openai/gemini path)", () => {
  it("stores and replays by sessionId:tool_call_id", () => {
    const t = tag();
    storeGeminiThoughtSignature(`${t}_call`, "sig-session", `${t}_sess`);
    expect(getGeminiThoughtSignatureSync(`${t}_call`, `${t}_sess`)).toBe("sig-session");
  });

  it("falls back to the bare toolCallId key when the session key misses", () => {
    const t = tag();
    storeGeminiThoughtSignature(`${t}_call`, "sig-bare", `${t}_sess`);
    // A different session misses `other:call` but hits the bare fallback key.
    expect(getGeminiThoughtSignatureSync(`${t}_call`, `${t}_other`)).toBe("sig-bare");
    expect(getGeminiThoughtSignatureSync(`${t}_call`)).toBe("sig-bare");
  });

  it("stores without a sessionId and replays under any session via the bare key", () => {
    const t = tag();
    storeGeminiThoughtSignature(`${t}_call`, "sig-nosess");
    expect(getGeminiThoughtSignatureSync(`${t}_call`, `${t}_whatever`)).toBe("sig-nosess");
  });

  it("writes both the session-namespaced key and the bare fallback on a sessioned store", () => {
    const t = tag();
    storeGeminiThoughtSignature(`${t}_call`, "sig-bare");
    storeGeminiThoughtSignature(`${t}_call`, "sig-session", `${t}_sess`);
    expect(getGeminiThoughtSignatureSync(`${t}_call`, `${t}_sess`)).toBe("sig-session");
    // A sessioned store also refreshes the bare key (upstream writes both), so
    // session-less lookups see the latest signature.
    expect(getGeminiThoughtSignatureSync(`${t}_call`)).toBe("sig-session");
  });

  it("rejects empty ids and signatures without throwing", () => {
    const t = tag();
    expect(() => storeGeminiThoughtSignature("", "sig", t)).not.toThrow();
    expect(() => storeGeminiThoughtSignature(`${t}_call`, "", t)).not.toThrow();
    expect(() => storeGeminiThoughtSignature(null, "sig", t)).not.toThrow();
    expect(getGeminiThoughtSignatureSync(`${t}_call`, t)).toBeNull();
    expect(getGeminiThoughtSignatureSync("", t)).toBeNull();
  });

  it("evicts the oldest entries once the LRU Map exceeds capacity (2000)", () => {
    const t = tag();
    const TOTAL = 2100;
    for (let i = 0; i < TOTAL; i++) {
      storeGeminiThoughtSignature(`${t}_${i}`, `sig-${i}`);
    }
    // Capacity is 2000, so the earliest writes (plus any from prior tests in
    // this file) must have been evicted in insertion order.
    expect(getGeminiThoughtSignatureSync(`${t}_0`)).toBeNull();
    expect(getGeminiThoughtSignatureSync(`${t}_1`)).toBeNull();
    expect(getGeminiThoughtSignatureSync(`${t}_${TOTAL - 1}`)).toBe(`sig-${TOTAL - 1}`);
  });

  it("async get replays from memory and returns null for unknown ids", async () => {
    const t = tag();
    storeGeminiThoughtSignature(`${t}_call`, "sig-async", `${t}_sess`);
    await expect(getGeminiThoughtSignature(`${t}_call`, `${t}_sess`)).resolves.toBe("sig-async");
    // Unknown id: memory miss, then SQLite lookup fails open (no DB in tests).
    await expect(getGeminiThoughtSignature(`${t}_unknown`, `${t}_sess`)).resolves.toBeNull();
  });
});
