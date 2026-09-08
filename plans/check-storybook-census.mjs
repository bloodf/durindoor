import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Planning snapshot integrity only: this cannot award story/runtime coverage.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || path.join(root, "plans/storybook-census.json");
const census = JSON.parse(readFileSync(file, "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: root });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const unique = (values, label) => {
  assert.equal(new Set(values).size, values.length, `${label}: duplicates`);
};
const paths = (rows, key) => rows.map((row) => row[key]);
const baseline = "cf572ec911afbef2e7cc1248a9be2e7a7b0d439a";
assert.equal(census.plannedAt, baseline);
assert.equal(census.status, "PLANNED_NOT_RUNTIME_VERIFIED");
assert.deepEqual(census.provenance.parseErrors, []);
assert.deepEqual(census.provenance.scanExtensions, [".js", ".jsx", ".mjs", ".ts", ".tsx"]);
assert.ok(census.provenance.scannerSource.length > 0);

const { rows, existingStories: stories, scannedModules: scanned, counts } = census;
unique(paths(rows, "id"), "source/symbol IDs");
unique(paths(scanned, "sourcePath"), "scanned modules");
unique(paths(stories, "path"), "story modules");
assert.equal(rows.length, 418, "planned snapshot row count");
assert.equal(counts.ledgerRows, rows.length);
assert.equal(counts.modules, new Set(paths(rows, "sourcePath")).size);
assert.equal(counts.symbolCandidates, rows.filter((row) => row.symbol !== "[module]").length);
assert.equal(counts.nonvisualModuleRows, rows.filter((row) => row.symbol === "[module]").length);
assert.equal(counts.symbolCandidates + counts.nonvisualModuleRows, rows.length);
assert.equal(counts.scannedModules, scanned.length);
assert.equal(counts.storyFiles, stories.length);
assert.equal(counts.csfNamedExports, stories.reduce((sum, story) => sum + story.stories.length, 0));
assert.equal(counts.sourceFilesIncludingStories, scanned.length + stories.length);
assert.equal(counts.referenceMockDataFiles, scanned.filter((row) => row.sourcePath.endsWith("/mockData.js") && row.sourcePath.startsWith("src/shared/ui/pages/")).length);

const sourceEntries = [...scanned.map((row) => [row.sourcePath, row.sourceSha256]),
  ...stories.map((story) => [story.path, story.sourceSha256])];
unique(sourceEntries.map(([source]) => source), "all source paths");
const sourceHashes = new Map(sourceEntries);
const storyIds = new Set(stories.map((story) => story.inventoryId));
unique(stories.map((story) => story.inventoryId), "story inventory IDs");
for (const row of rows) {
  assert.equal(row.id, `${row.sourcePath}#${row.symbol}`);
  assert.equal(row.reviewStatus, "pending", `${row.id}: premature approval`);
  assert.equal(row.existingRuntimeCoverage, "UNVERIFIED");
  assert.deepEqual(row.approvedStoryScenarios, []);
  assert.equal(row.approvedException, null);
  assert.equal(row.reviewedBy, null);
  assert.equal(row.sourceSha256, sourceHashes.get(row.sourcePath));
  assert.ok(Array.isArray(row.requiredAxes));
  assert.ok(row.existingStoryModuleIds.every((id) => storyIds.has(id)));
}
for (const row of scanned) assert.equal(row.reviewStatus, "pending");
for (const story of stories) unique(story.stories, `${story.path}: exports`);

const eligible = (source) => source.startsWith("src/") && /\.(js|jsx|mjs|ts|tsx)$/.test(source) && !/\.(test|spec)\./.test(source);
const expected = git("ls-tree", "-r", "--name-only", "-z", baseline, "--", "src").toString().split("\0").filter(eligible).sort();
assert.deepEqual([...sourceHashes.keys()].sort(), expected, "complete planned source path set");
const current = git("ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src").toString().split("\0").filter(eligible).sort();
assert.deepEqual(current, expected, "source path drift: refresh census deliberately");

// One Git process reads all planned blobs; compare baseline AND working bytes.
const blobs = execFileSync("git", ["cat-file", "--batch"], {
  cwd: root,
  input: expected.map((source) => `${baseline}:${source}`).join("\n") + "\n",
  maxBuffer: 64 * 1024 * 1024,
});
let offset = 0;
for (const source of expected) {
  const end = blobs.indexOf(10, offset);
  assert.ok(end >= offset, `${source}: missing object header`);
  const header = blobs.subarray(offset, end).toString().match(/^[0-9a-f]+ blob (\d+)$/);
  assert.ok(header, `${source}: missing planned blob`);
  const size = Number(header[1]);
  const start = end + 1;
  assert.equal(hash(blobs.subarray(start, start + size)), sourceHashes.get(source), `${source}: planned hash mismatch`);
  assert.equal(hash(readFileSync(path.join(root, source))), sourceHashes.get(source), `${source}: current source drift`);
  offset = start + size + 1;
}
assert.equal(offset, blobs.length);
console.log(`Planning census integrity passed: ${rows.length} pending rows; ${scanned.length} modules + ${stories.length} story files; ${counts.csfNamedExports} CSF exports. No runtime coverage claimed.`);
