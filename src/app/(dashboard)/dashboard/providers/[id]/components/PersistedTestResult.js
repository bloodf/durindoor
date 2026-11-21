"use client";

const STATUS_LABEL = {
  success: "passed",
  failed: "failed",
  skipped: "not supported",
  unavailable: "provider unavailable",
};

/** Last persisted test result for a connection; safe message and timestamp only. */
export default function PersistedTestResult({ result }) {
  if (!result) return null;
  return (
    <span className="block px-3 pb-1 text-xs text-dd-muted" role="status" data-testid="persisted-test-result">
      Last test {STATUS_LABEL[result.status]}: {result.message}{" "}
      <time dateTime={result.testedAt}>{new Date(result.testedAt).toLocaleString()}</time>
    </span>
  );
}
