// Pure status classifier kept JSX-free so unit tests can import without
// running React. The dashboard imports the same function and feeds it
// service reports.
export function serviceStatus(svc, dryRun) {
  if (!svc) return { label: "Unknown", variant: "default" };
  // Change wins over absence: a dry-run can plan to install an absent service
  // (e.g. headroom installed:false, wouldInstall:true, wouldChange:true).
  const willChange = dryRun ? svc.wouldChange : svc.changed;
  // A reachable external service (running:true, installed:false) counts as present
  // even without a local CLI binary. Headroom reports both; Firecrawl reports
  // detected/running; pxpipe reports installed/running.
  const present =
    svc.running === true ||
    (svc.detected !== false && svc.installed !== false);
  if (!present) return { label: "Unavailable", variant: "default" };

  return { label: "Up to date", variant: "success" };
}
