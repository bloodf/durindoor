import { describe, expect, it } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { buildOutput } from "../../open-sse/rtk/filters/buildOutput.js";
import { smartTruncate } from "../../open-sse/rtk/filters/smartTruncate.js";

describe("OmniRoute #21191 6183deb8897a04d75967552c9b676b2bf0f03a97 RTK outcome lines and per-file elision", () => {
  it("keeps outcome lines through the keep-only build filter and still drops progress", () => {
    const out = buildOutput(["   Compiling a v1", "test a ... ok", "VET_OK", "TEST_EXIT=0", "exit code 0", "SUCCESS", "[rtk:dropped 2 repeated lines]"].join("\n"));
    for (const line of ["VET_OK", "TEST_EXIT=0", "exit code 0", "SUCCESS", "[rtk:dropped 2 repeated lines]"]) expect(out).toContain(line);
    expect(out).not.toContain("test a ... ok");
  });

  it("does not hand a document to the build filter for one Error: line", () => {
    const doc = ["Error: an example in the prose", "one", "two", "three", "four", "five"].join("\n");
    expect(autoDetectFilter(doc)?.filterName).not.toBe("build-output");
    expect(autoDetectFilter("ERROR: first\nERROR: second\n")?.filterName).toBe("build-output");
  });

  it("keeps every file header and a slice of each file", () => {
    const input = ["a", "b", "c", "d"].flatMap((name) => [`=== ${name}.ts ===`, ...Array.from({ length: 100 }, (_, i) => `${name}-${i}`)]).join("\n");
    const out = smartTruncate(input);
    for (const name of ["a", "b", "c", "d"]) {
      expect(out).toContain(`=== ${name}.ts ===`);
      expect(out).toContain(`${name}-0\n`);
      expect(out).toContain(`${name}-99`);
    }
    expect(out.match(/lines truncated/g)).toHaveLength(4);
    expect(out.split("\n").length).toBeLessThan(200);
  });
});
