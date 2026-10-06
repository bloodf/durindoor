/** Badge tone for a trace status; swimlane bars reuse it so table and chart agree. */
export function statusTone(status) {
  if (status === "ok") return "success";
  if (status === "aborted") return "warning";
  if (status === "error") return "danger";
  if (status === "running") return "info";
  return "neutral";
}
