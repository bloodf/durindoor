import { writeFileSync } from "node:fs";
import { validateCompletedReportStates } from "./report-states.mjs";

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

export function writeJunitReport(report, outputPath) {
  validateCompletedReportStates(report);
  const suites = report.testResults;
  const tests = suites.flatMap((suite) => suite.assertionResults || []);
  const failures = tests.filter((test) => test.status === "failed").length;
  const skipped = tests.filter((test) => ["skipped", "todo"].includes(test.status)).length;
  const body = suites.map((suite) => {
    const cases = (suite.assertionResults || []).map((test) => {
      const failure = test.status === "failed"
        ? `<failure message="test failed">${escapeXml((test.failureMessages || []).join("\n"))}</failure>`
        : ["skipped", "todo"].includes(test.status)
          ? "<skipped/>"
          : "";
      return `<testcase classname="${escapeXml(suite.name)}" name="${escapeXml(test.fullName || test.title)}">${failure}</testcase>`;
    }).join("");
    return `<testsuite name="${escapeXml(suite.name)}" tests="${(suite.assertionResults || []).length}" failures="${(suite.assertionResults || []).filter((test) => test.status === "failed").length}">${cases}</testsuite>`;
  }).join("");
  writeFileSync(outputPath, `<?xml version="1.0" encoding="UTF-8"?><testsuites tests="${tests.length}" failures="${failures}" skipped="${skipped}">${body}</testsuites>\n`);
}

export function writeDiagnosticJunit(error, outputPath) {
  writeFileSync(
    outputPath,
    `<?xml version="1.0" encoding="UTF-8"?><testsuites tests="1" failures="1"><testsuite name="vitest infrastructure" tests="1" failures="1"><testcase classname="ci" name="test runner"><failure message="infrastructure failure">${escapeXml(error?.stack || error?.message || error)}</failure></testcase></testsuite></testsuites>\n`,
  );
}
