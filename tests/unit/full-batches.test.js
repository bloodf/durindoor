import { describe, expect, it } from "vitest";
import { partitionInventory, mergeBatchReports } from "../__baseline__/full-batches.mjs";

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
});
