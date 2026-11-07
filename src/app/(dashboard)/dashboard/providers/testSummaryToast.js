// Skipped web-session connections were never probed, so they must not read as "passed".
export function testSummaryToast({ passed, failed, skipped = 0, unavailable = 0, total }) {
  if (failed === 0 && skipped === 0 && unavailable === 0) return { level: "success", message: `All ${total} tests passed` };
  const details = [failed ? `${failed} failed` : "", skipped ? `${skipped} skipped` : "", unavailable ? `${unavailable} unavailable` : ""].filter(Boolean).join(", ");
  return { level: "warning", message: `${passed}/${total} passed, ${details}` };
}
