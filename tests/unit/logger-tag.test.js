import { describe, expect, it } from "vitest";
import { nextTag, tagForSession } from "../../src/sse/utils/logger.js";

const TAG_RE = /^(🟢|🔵|🟣|🟡|🟠|🔴|⚪|🟤)$/;

describe("logger session tag helpers", () => {
  it("tagForSession returns a well-formed colored-dot tag", () => {
    expect(tagForSession("session-alpha")).toMatch(TAG_RE);
  });

  it("tagForSession is stable for the same seed", () => {
    expect(tagForSession("conn-1234")).toBe(tagForSession("conn-1234"));
  });

  it("tagForSession maps distinct seeds across the palette", () => {
    const tags = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((s) => tagForSession(s))
    );
    // Distinct seeds should not all collapse onto a single dot.
    expect(tags.size).toBeGreaterThan(1);
    for (const t of tags) expect(t).toMatch(TAG_RE);
  });

  it("nextTag returns a well-formed colored-dot tag", () => {
    expect(nextTag()).toMatch(TAG_RE);
  });

  it("nextTag rotates through all 8 palette entries before repeating", () => {
    const tags = Array.from({ length: 8 }, () => nextTag());
    for (const t of tags) expect(t).toMatch(TAG_RE);
    expect(new Set(tags).size).toBe(8);
    // 9th call wraps back to the first entry of the cycle.
    expect(nextTag()).toBe(tags[0]);
  });

  it("tagForSession falls back to a rotating tag when seed is empty", () => {
    expect(tagForSession("")).toMatch(TAG_RE);
    expect(tagForSession(undefined)).toMatch(TAG_RE);
  });
});
