/** Build /dashboard/timeline query hrefs for provider and connection View all. */
export function buildTimelineHref({ provider, connectionId } = {}) {
  const q = new URLSearchParams();
  if (provider) q.set("provider", provider);
  if (connectionId) q.set("connectionId", connectionId);
  const s = q.toString();
  return s ? `/dashboard/timeline?${s}` : "/dashboard/timeline";
}
