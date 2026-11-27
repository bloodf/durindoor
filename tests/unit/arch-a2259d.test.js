import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { requestRegistry, responseRegistry } from "../../open-sse/translator/registry.js";

const DOC_PATH = new URL("../../internal/docs/v5-protocol-conformance.md", import.meta.url);
const INDEX_PATH = new URL("../../open-sse/translator/index.js", import.meta.url);

describe("#2259 item 2: protocol conformance doc anchors and pivot exceptions", () => {
  it("contains no line-number anchors", async () => {
    const doc = await readFile(DOC_PATH, "utf8");
    expect(doc).not.toMatch(/#L\d+/);
  });

  it("names every direct (non-hub) pair registered in the translator", async () => {
    const doc = await readFile(DOC_PATH, "utf8");
    const table = doc.split("### Pivot exceptions")[1]?.split("\n## ")[0];
    expect(table).toBeDefined();

    const directPairs = [];
    for (const [direction, registry] of [["Request", requestRegistry], ["Response", responseRegistry]]) {
      const pairs = [...registry.keys()].filter((key) => !key.split(":").includes(FORMATS.OPENAI));
      expect(pairs.length).toBeGreaterThan(0);
      for (const pair of pairs) {
        directPairs.push(pair);
        expect(table).toContain(`| ${direction} | \`${pair}\` |`);
      }
    }
    expect(directPairs.sort()).toEqual(["claude:gemini", "claude:kiro", "gemini:claude", "kiro:claude"]);
  });

  it("lists the OPENAI_RESPONSES + CLAUDE + searchEnabled special case", async () => {
    const doc = await readFile(DOC_PATH, "utf8");
    const index = await readFile(INDEX_PATH, "utf8");
    expect(doc).toContain("| Response | `OPENAI_RESPONSES` → `CLAUDE` with `searchEnabled` |");
    expect(index).toMatch(/targetFormat === FORMATS\.OPENAI_RESPONSES && sourceFormat === FORMATS\.CLAUDE && state\.searchEnabled/);
  });

  it("gives every pivot-exception row a file link that exists on disk", async () => {
    const doc = await readFile(DOC_PATH, "utf8");
    const table = doc.split("### Pivot exceptions")[1]?.split("\n## ")[0] ?? "";
    const rows = table.split("\n").filter((line) => /^\| (Request|Response) \|/.test(line));
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const cells = row.split("|").map((cell) => cell.trim());
      const fileCell = cells[3];
      const link = fileCell.match(/\]\(([^)]+)\)/);
      expect(link, `row has no file link: ${row}`).not.toBeNull();
      const target = fileURLToPath(new URL(link[1], DOC_PATH));
      expect(existsSync(target), `missing file for row: ${row}`).toBe(true);
      expect(cells[4].length, `row has no reason: ${row}`).toBeGreaterThan(0);
    }
  });
});
