import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comboConversationAffinity, getRotatedModels, resetComboRotation } from "../../open-sse/services/combo.js";

const rotate = (id, scope = "caller") => getRotatedModels(["a", "b"], "affinity", "round-robin", 2, id, [], scope);

beforeEach(() => { resetComboRotation(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetComboRotation(); });

describe("conversation affinity pruning", () => {
  it("does not walk the map for 10,000 requests under the cap", () => {
    const walk = vi.spyOn(comboConversationAffinity, Symbol.iterator);
    for (let i = 0; i < 10000; i++) rotate(`conversation-${i % 999}`);
    expect(walk).not.toHaveBeenCalled();
  });

  it("evicts expired entries first, then the oldest, within each scope's cap", () => {
    rotate("expired");
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    for (let i = 0; i < 1000; i++) rotate(`fresh-${i}`);
    expect(comboConversationAffinity.size).toBe(1000);
    expect(comboConversationAffinity.has('affinity:expired:key:"caller"')).toBe(false);
    rotate("overflow");
    expect(comboConversationAffinity.size).toBe(1000);
    expect(comboConversationAffinity.has('affinity:fresh-0:key:"caller"')).toBe(false);
  });

  it("does not return an expired pin even without a full prune", () => {
    expect(rotate("old")[0]).toBe("a");
    rotate("other");
    rotate("third");
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(rotate("old")[0]).toBe("b");
  });
});

it("shares runtime state across module instances and resets it", async () => {
  rotate("shared");
  vi.resetModules();
  const other = await import("../../open-sse/services/combo.js");
  expect(other.comboConversationAffinity).toBe(comboConversationAffinity);
  expect(other.comboConversationAffinity.size).toBe(1);
  other.resetComboRotation();
  expect(comboConversationAffinity.size).toBe(0);
});
