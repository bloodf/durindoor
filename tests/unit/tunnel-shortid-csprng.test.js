import { beforeEach, describe, expect, it, vi } from "vitest";

const randomInt = vi.fn((minimum) => minimum);
vi.mock("node:crypto", () => ({ randomInt }));

const { generateShortId } = await import("@/lib/tunnel/shared/state.js");

describe("tunnel short id", () => {
  beforeEach(() => randomInt.mockClear());

  it("draws every character from the bounded OS CSPRNG", () => {
    expect(generateShortId()).toBe("aaaaaa");
    expect(randomInt).toHaveBeenCalledTimes(6);
    expect(randomInt).toHaveBeenCalledWith(0, 33);
  });

  it("preserves the six-character tunnel URL alphabet contract", () => {
    randomInt.mockReturnValue(32);
    expect(generateShortId()).toBe("999999");
  });
});
