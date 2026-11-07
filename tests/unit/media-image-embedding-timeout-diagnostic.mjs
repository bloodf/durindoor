// Run only under the private, network-blocked 300-second supervisor. The child
// deliberately fails one hook; its raw reports are evidence, not baseline data.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [variant, sourcePath, configPath, reportDir] = process.argv.slice(2);
if (!["old", "candidate"].includes(variant) || !sourcePath || !configPath || !reportDir || !path.isAbsolute(reportDir)) {
  throw new Error("Usage: node media-image-embedding-timeout-diagnostic.mjs <old|candidate> <source> <guarded-config> <private-report-dir>");
}
const testsDir = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(sourcePath, "utf8");
const generated = path.join(testsDir, "unit", `media-timeout-${process.pid}.test.js`);
const eventsPath = path.join(reportDir, `${variant}.events.jsonl`);
const reports = (suffix) => path.join(reportDir, `${variant}.${suffix}`);
fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });
for (const suffix of ["events.jsonl", "stdout", "stderr", "json", "xml", "exit", "instrumented.js"]) {
  if (fs.existsSync(reports(suffix))) throw new Error(`Refusing to overwrite ${reports(suffix)}`);
}
function replaceOnce(text, needle, replacement) {
  const start = text.indexOf(needle);
  if (start < 0 || text.indexOf(needle, start + needle.length) >= 0) throw new Error(`Expected exactly one instrumentation seam: ${needle}`);
  return text.slice(0, start) + replacement + text.slice(start + needle.length);
}
let instrumented = `import { appendFileSync as diagnosticAppend } from "node:fs";\nlet diagnosticSequence = 0;\nconst diagnosticEvent = (event, id, directory) => diagnosticAppend(${JSON.stringify(eventsPath)}, JSON.stringify({ event, id, directory }) + "\\n");\n` + source;
if (variant === "old") instrumented = replaceOnce(instrumented, 'vi.mock("open-sse/utils/proxyFetch.js",', 'vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "kimchi/0.1.01" }));\nvi.mock("open-sse/utils/proxyFetch.js",');
const firstBody = 'it("prices returned images with an exact operator rate, then denies before the next dispatch", async () => {';
const secondBody = 'it("direct: one attributed record, then denial before dispatch", async () => {';
instrumented = replaceOnce(instrumented, firstBody, `${firstBody}\n    diagnosticEvent("first-body", 1);`);
instrumented = replaceOnce(instrumented, secondBody, `${secondBody}\n    diagnosticEvent("second-body", 2);\n    await new Promise((resolve) => setTimeout(resolve, 1800));`);
if (variant === "old") {
  instrumented = replaceOnce(instrumented, '  directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-embedding-budget-"));', '  directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-embedding-budget-"));\n  const diagnosticId = ++diagnosticSequence; const diagnosticDirectory = directory;\n  diagnosticEvent("allocated", diagnosticId, diagnosticDirectory);');
  instrumented = replaceOnce(instrumented, '  vi.stubGlobal("fetch", vi.fn());\n  database = await import("@/lib/db/index.js");', '  vi.stubGlobal("fetch", vi.fn());\n  if (diagnosticId === 1) await new Promise((resolve) => setTimeout(resolve, 11000));\n  diagnosticEvent("continuation", diagnosticId, diagnosticDirectory);\n  database = await import("@/lib/db/index.js");');
  instrumented = replaceOnce(instrumented, '  database = await import("@/lib/db/index.js");\n  adapter = await (await import("@/lib/db/driver.js")).getAdapter();', '  database = await import("@/lib/db/index.js");\n  adapter = await (await import("@/lib/db/driver.js")).getAdapter();\n  diagnosticEvent("published", diagnosticId, diagnosticDirectory);');
  instrumented = replaceOnce(instrumented, 'afterEach(async () => {\n  await global._dbAdapter?.instance?.close?.();', 'afterEach(async () => {\n  diagnosticEvent("cleanup", diagnosticSequence, directory);\n  await global._dbAdapter?.instance?.close?.();');
} else {
  instrumented = replaceOnce(instrumented, '  const owner = privateEnvironment("image-embedding-budget-");\n  entry.state = owner;', '  const owner = privateEnvironment("image-embedding-budget-");\n  entry.state = owner;\n  const diagnosticId = ++diagnosticSequence; owner.diagnosticId = diagnosticId;\n  diagnosticEvent("allocated", diagnosticId, owner.directory);');
  instrumented = replaceOnce(instrumented, '  let caseDatabase;\n  try { caseDatabase = await import("@/lib/db/index.js"); }', '  if (diagnosticId === 1) await new Promise((resolve) => setTimeout(resolve, 11000));\n  diagnosticEvent("continuation", diagnosticId, owner.directory);\n  signal.throwIfAborted();\n  let caseDatabase;\n  try { caseDatabase = await import("@/lib/db/index.js"); }');
  instrumented = replaceOnce(instrumented, '  adapter = caseAdapter; database = caseDatabase; handleImage = image.handleImageGeneration; handleEmbeddings = embeddings.handleEmbeddings;', '  adapter = caseAdapter; database = caseDatabase; handleImage = image.handleImageGeneration; handleEmbeddings = embeddings.handleEmbeddings;\n  diagnosticEvent("published", diagnosticId, owner.directory);');
  instrumented = replaceOnce(instrumented, '  disposeEnvironment(owner);\n}));', '  disposeEnvironment(owner);\n  diagnosticEvent("cleanup", owner.diagnosticId, owner.directory);\n}));');
}
fs.writeFileSync(reports("instrumented.js"), instrumented, { mode: 0o600 });
fs.writeFileSync(generated, instrumented, { mode: 0o600, flag: "wx" });
let result;
try {
  const args = ["node_modules/vitest/vitest.mjs", "run", path.relative(testsDir, generated), "--config", path.resolve(configPath), "--maxWorkers=2", "--testNamePattern", "prices returned images with an exact operator rate|direct: one attributed record", "--reporter=default", "--reporter=json", "--reporter=junit", `--outputFile.json=${reports("json")}`, `--outputFile.junit=${reports("xml")}`];
  result = spawnSync(process.execPath, args, { cwd: testsDir, env: process.env, encoding: "utf8", timeout: 295000, maxBuffer: 50 * 1024 * 1024 });
  fs.writeFileSync(reports("stdout"), result.stdout || "", { mode: 0o600 });
  fs.writeFileSync(reports("stderr"), result.stderr || "", { mode: 0o600 });
  fs.writeFileSync(reports("exit"), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }) + "\n", { mode: 0o600 });
} finally {
  fs.rmSync(generated, { force: true });
}
if (result.error || result.status !== 1) throw new Error("Child did not exit with the expected test failure; inspect raw reports");
const report = JSON.parse(fs.readFileSync(reports("json"), "utf8"));
const cases = report.testResults.flatMap((file) => file.assertionResults);
const first = cases.find((test) => test.fullName.includes("prices returned images with an exact operator rate"));
const second = cases.find((test) => test.fullName.includes("direct: one attributed record"));
const stderr = fs.readFileSync(reports("stderr"), "utf8").replace(/\u001b\[[0-9;]*m/g, "");
if (report.numFailedTests !== 1 || first?.status !== "failed" || second?.status !== "passed" || !stderr.includes("Hook timed out in 10000ms") || !stderr.includes("prices returned images with an exact operator rate")) {
  throw new Error("Child did not retain precisely the injected hook timeout and a passing later case; inspect raw reports");
}
const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
const index = (event, id) => events.findIndex((item) => item.event === event && item.id === id);
if (index("first-body", 1) !== -1 || index("second-body", 2) < 0 || index("continuation", 1) < 0) throw new Error("Required child execution events missing");
const isolated = index("cleanup", 1) >= 0 && index("cleanup", 1) < index("allocated", 2) && index("published", 1) < 0;
if (variant === "candidate" && !isolated) throw new Error("Candidate violated cancellation or cleanup isolation");
if (variant === "old" && isolated) throw new Error("Old fixture did not reproduce the target violation; no fail-before established");
console.log(JSON.stringify({ variant, injectedTimeoutRetained: true, laterBodyPassed: true, isolation: isolated, events }, null, 2));
