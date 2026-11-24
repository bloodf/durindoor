import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { requestRegistry, responseRegistry } from "../../open-sse/translator/registry.js";

describe("protocol conformance documentation", () => {
  it("avoids line anchors and lists every registered non-hub pair", async () => {
    const doc = await readFile(new URL("../../internal/docs/v5-protocol-conformance.md", import.meta.url), "utf8");
    expect(doc).not.toMatch(/#L\d+/);

    const table = doc.split("### Pivot exceptions")[1]?.split("\n## ")[0];
    expect(table).toBeDefined();
    for (const [direction, registry] of [["Request", requestRegistry], ["Response", responseRegistry]]) {
      const pairs = [...registry.keys()].filter((key) => !key.split(":").includes(FORMATS.OPENAI));
      expect(pairs.length).toBeGreaterThan(0);
      for (const pair of pairs) {
        expect(table).toContain(`| ${direction} | \`${pair}\` |`);
      }
    }
    expect(table).toContain("`OPENAI_RESPONSES` → `CLAUDE` with `searchEnabled`");
  });
});
