import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getEarliestActiveModelLock, hasModelLock } from "../../src/shared/utils/modelLockCountdown.js";

const NOW = Date.parse("2026-11-26T08:00:00.000Z");
const at = (seconds) => new Date(NOW + seconds * 1000).toISOString();
const source = (path) => readFileSync(new URL(`../../src/app/(dashboard)/dashboard/providers/${path}`, import.meta.url), "utf8");

describe("9router #3910 (9a49c0700860) - count down to a lock that has not expired", () => {
  it("skips a lapsed model lock in favour of a live account lock", () => {
    const connection = { "modelLock_gpt-5": at(-30), modelLock___all: at(120) };

    expect(getEarliestActiveModelLock(connection, NOW)).toBe(at(120));
  });

  it("picks the earliest of several live locks", () => {
    const connection = { modelLock_a: at(300), modelLock_b: at(60), modelLock_c: null, rateLimitedUntil: at(5) };

    expect(getEarliestActiveModelLock(connection, NOW)).toBe(at(60));
  });

  it("returns null when every lock lapsed or is unreadable", () => {
    const connection = { modelLock_a: at(-1), modelLock_b: "not-a-date" };

    expect(getEarliestActiveModelLock(connection, NOW)).toBeNull();
    expect(hasModelLock(connection)).toBe(true);
    expect(hasModelLock({ modelLock_a: null })).toBe(false);
  });

  it.each(["[id]/ConnectionRow.js", "components/ConnectionsCard.js"])("%s counts down to the live lock", (path) => {
    expect(source(path)).toContain("getEarliestActiveModelLock(connection)");
    expect(source(path)).not.toContain('startsWith("modelLock_")');
  });
});
