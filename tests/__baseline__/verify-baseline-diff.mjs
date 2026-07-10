import { spawnSync } from "node:child_process";

export function addedBaselineEntries(diffText) {
  return diffText
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
}

export function verifyBaselineDiff(baseRef = process.env.BASELINE_BASE_REF) {
  if (!baseRef) {
    console.log("Baseline additions check: skipped (BASELINE_BASE_REF not set)");
    return [];
  }
  const result = spawnSync("git", ["diff", "--unified=0", baseRef, "--", "tests/__baseline__/known-fails.txt"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(result.stderr || `git diff exited ${result.status}`);
  }
  const additions = addedBaselineEntries(result.stdout);
  if (additions.length > 0) {
    throw new Error(`Baseline additions are forbidden:\n${additions.map((entry) => `  - ${entry}`).join("\n")}`);
  }
  console.log("Baseline additions check: no additions");
  return additions;
}

if (process.argv[1]?.endsWith("verify-baseline-diff.mjs")) {
  try {
    verifyBaselineDiff(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
