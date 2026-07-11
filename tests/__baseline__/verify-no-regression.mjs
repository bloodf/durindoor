import { readFileSync } from "node:fs";
import path, { relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const relKey = (file) => relative(repoRoot, file).split("\\").join("/");

export function readKnownFails() {
  return new Set(
    readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export function analyzeVitestReport(report, knownFails = readKnownFails()) {
  if (!report || !Array.isArray(report.testResults)) {
    throw new Error("Vitest JSON report is missing testResults[]");
  }
  const rawFailures = report.testResults.flatMap((file) => {
    if (!Array.isArray(file.assertionResults)) {
      throw new Error(`Vitest result for ${file.name || "unknown file"} is missing assertionResults[]`);
    }
    return file.assertionResults
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => `${relKey(file.name)} :: ${assertion.fullName || assertion.title || "unnamed test"}`);
  });
  const rawFailureSet = new Set(rawFailures);
  return {
    rawFailures,
    knownFailures: rawFailures.filter((failure) => knownFails.has(failure)),
    regressions: rawFailures.filter((failure) => !knownFails.has(failure)),
    staleBaseline: [...knownFails].filter((failure) => !rawFailureSet.has(failure)),
    knownCount: knownFails.size,
  };
}

export function printAnalysis(analysis) {
  console.log(`Raw failures: ${analysis.rawFailures.length}`);
  console.log(`Known failures still failing: ${analysis.knownFailures.length}`);
  console.log(`Stale baseline entries now passing: ${analysis.staleBaseline.length}`);
  if (analysis.regressions.length > 0) {
    console.error(`\nRegressions outside the baseline (${analysis.regressions.length}):`);
    for (const failure of analysis.regressions) console.error(`  - ${failure}`);
  }
  if (analysis.staleBaseline.length > 0) {
    console.log("\nBaseline entries eligible for deletion:");
    for (const failure of analysis.staleBaseline) console.log(`  - ${failure}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const resultsPath = process.argv[2];
  if (!resultsPath) {
    console.error("Missing results.json path");
    process.exit(2);
  }
  try {
    const report = JSON.parse(readFileSync(resultsPath, "utf8"));
    const analysis = analyzeVitestReport(report);
    printAnalysis(analysis);
    process.exit(analysis.regressions.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(`Invalid Vitest report: ${error.message}`);
    process.exit(2);
  }
}
