import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MODEL_LOCK_ALL,
  getModelLockKey,
  isModelLockActive,
} from "../../open-sse/services/accountFallback.js";

const MODEL = "claude-fable-5";
const NOW = new Date("2026-08-27T12:00:00.000Z");
const expired = "2026-08-27T11:59:00.000Z";
const active = "2026-08-27T12:01:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isModelLockActive precedence", () => {
  it("keeps an account unavailable when its exact lock expired but its account-wide lock is active", () => {
    const connection = {
      [getModelLockKey(MODEL)]: expired,
      [MODEL_LOCK_ALL]: active,
    };

    expect(isModelLockActive(connection, MODEL)).toBe(true);
    expect(isModelLockActive(connection, "some-other-model")).toBe(true);
  });

  it("keeps an active exact-model lock", () => {
    expect(isModelLockActive({ [getModelLockKey(MODEL)]: active }, MODEL)).toBe(true);
  });

  it("releases a connection when both applicable locks expired", () => {
    const connection = {
      [getModelLockKey(MODEL)]: expired,
      [MODEL_LOCK_ALL]: expired,
    };

    expect(isModelLockActive(connection, MODEL)).toBe(false);
  });

  it("treats a malformed timestamp as inactive", () => {
    expect(isModelLockActive({ [getModelLockKey(MODEL)]: "not-a-date" }, MODEL)).toBe(false);
  });

  it("returns false when no applicable lock exists", () => {
    expect(isModelLockActive({}, MODEL)).toBe(false);
  });
});
