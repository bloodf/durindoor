// Vitest 4.1.12 JsonReporter emits only passed/failed suites. Explicit skip/todo
// assertions are terminal; pending represents run/queued/only, not a skip.
export function validateCompletedReportStates(report) {
  if (!Array.isArray(report?.testResults)) throw new Error("Vitest report has no testResults[]");
  for (const suite of report.testResults) {
    if (!suite || !["passed", "failed"].includes(suite.status)) {
      throw new Error("Vitest report has unfinished or unsupported suite status");
    }
    if (!Array.isArray(suite.assertionResults)) throw new Error("Vitest suite has no assertionResults[]");
    for (const test of suite.assertionResults) {
      if (!test || !["passed", "failed", "skipped", "todo"].includes(test.status)) {
        throw new Error("Vitest report has unfinished or unsupported assertion status");
      }
    }
  }
}
