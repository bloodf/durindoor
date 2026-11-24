import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  partitionInventory, mergeBatchReports, combineBatchReports, fullBatchArgs, mandatoryTestInventory,
  missingFromDiscovery, FULL_BATCH_COUNT, FULL_BATCH_WORKERS,
} from "../__baseline__/full-batches.mjs";

const root = "/private/tests";
const report = (files) => ({ success: true, numPassedTests: files.length, numTotalTests: files.length,
  testResults: files.map(file => ({ name: `${root}/${file}`, status: "passed",
    assertionResults: [{ status: "passed", fullName: "consumer behavior" }] })) });

describe("full gate batch completeness", () => {
  it("partitions every discovered file exactly once in stable order", () => {
    const files = Array.from({ length: 9 }, (_, i) => `unit/${i}.test.js`);
    const batches = partitionInventory(files.map(file => ({ file: `${root}/${file}` })), root);
    expect(batches.flat().sort()).toEqual(files);
    expect(batches.map(b => b.length)).toEqual([3, 2, 2, 2]);
    expect(() => partitionInventory([{ file: "/outside.test.js" }], root, 1)).toThrow();
    expect(() => partitionInventory([{ file: `${root}/a.test.js` }, { file: `${root}/a.test.js` }], root, 1)).toThrow(/duplicate/);
    expect(() => partitionInventory([], root)).toThrow(/empty/);
  });
  it("rejects missing, repeated, extra, and cross-batch execution", () => {
    const batches = [["unit/a.test.js"], ["unit/b.test.js"]];
    expect(mergeBatchReports(batches, batches.map(report), root).numPassedTests).toBe(2);
    for (const reports of [[report(batches[0])], [report(batches[0]), report(batches[0])],
      [report([...batches[0], ...batches[1]]), report(batches[1])], [report(batches[1]), report(batches[0])]]) {
      expect(() => mergeBatchReports(batches, reports, root)).toThrow();
    }
  });
  it("rejects assertion and infrastructure failures even with success metadata", () => {
    const batches = [["unit/a.test.js"]];
    const failed = report(batches[0]);
    failed.testResults[0].assertionResults[0].status = "failed";
    expect(() => mergeBatchReports(batches, [failed], root)).toThrow();
    const runtime = { ...report(batches[0]), unhandledErrors: ["worker crashed"] };
    expect(() => mergeBatchReports(batches, [runtime], root)).toThrow(/runtime/);
  });
  it("keeps the gate within four sequential commands of four isolated forks", () => {
    expect(FULL_BATCH_COUNT).toBe(4);
    expect(FULL_BATCH_WORKERS).toBe(4);
    expect(fullBatchArgs(root, ["unit/a.test.js"], "/r.json")).toEqual([
      path.join(root, "node_modules/vitest/vitest.mjs"), "run", "unit/a.test.js",
      "--maxWorkers=4", "--isolate", "--pool=forks", "--reporter=verbose", "--reporter=json", "--outputFile.json=/r.json",
    ]);
  });
  it("derives the mandatory inventory from tracked files with the configured exclusions", () => {
    const tracked = ["tests/unit/b.test.js", "tests/unit/a.test.js", "tests/unit/x.live.test.js", "src/a.test.js",
      "tests/.omc/w/c.test.js", "tests/omp-extension/d.test.js", "tests/unit/helper.js", "tests/unit/embeddings.cloud.test.js"];
    expect(mandatoryTestInventory(tracked)).toEqual(["unit/a.test.js", "unit/b.test.js"]);
    expect(mandatoryTestInventory(tracked, { hasCloud: true })).toContain("unit/embeddings.cloud.test.js");
    expect(missingFromDiscovery([["unit/a.test.js"]], ["unit/a.test.js", "unit/b.test.js"])).toEqual(["unit/b.test.js"]);
    expect(missingFromDiscovery([["unit/a.test.js"], ["unit/b.test.js"]], ["unit/a.test.js", "unit/b.test.js"])).toEqual([]);
  });
  it("combines failing batches for regression analysis without hiding failures or coverage gaps", () => {
    const batches = [["unit/a.test.js"], ["unit/b.test.js"]];
    const failed = report(batches[1]);
    failed.success = false;
    failed.numFailedTests = 1;
    failed.testResults[0].assertionResults[0].status = "failed";
    const merged = combineBatchReports(batches, [report(batches[0]), failed], root);
    expect(merged.success).toBe(false);
    expect(merged.numFailedTests).toBe(1);
    expect(merged.testResults.flatMap(s => s.assertionResults).filter(a => a.status === "failed")).toHaveLength(1);
    expect(() => combineBatchReports(batches, [report(batches[0]), report([])], root)).toThrow(/mismatch/);
    expect(() => combineBatchReports(batches, [report(batches[0]), {}], root)).toThrow(/testResults/);
    const runtime = combineBatchReports(batches, [report(batches[0]), { ...report(batches[1]), unhandledErrors: ["boom"] }], root);
    expect(runtime.unhandledErrors).toEqual(["boom"]);
  });
});
