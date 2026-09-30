// Skipped web-session connections were never probed, so they must not read as "passed".
export function testSummaryToast({ passed, failed, skipped = 0, total }) {
  if (failed === 0 && skipped === 0) return { level: "success", message: `All ${total} tests passed` };
  if (failed === 0) return { level: "warning", message: `${passed}/${total} passed, ${skipped} skipped` };
  return { level: "warning", message: `${passed}/${total} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}` };
}
