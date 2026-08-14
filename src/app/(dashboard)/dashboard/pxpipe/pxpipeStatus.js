const STATUS_URL = "/api/pxpipe/status";

export async function fetchPxpipeStatus(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(STATUS_URL, {
      headers: { "Cache-Control": "no-store" },
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return { error: data?.error || `PXPIPE status failed (${response.status})`, loading: false };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { error: "PXPIPE status returned invalid JSON", loading: false };
    }
    return { ...data, error: null, loading: false };
  } catch (error) {
    return { error: error?.message || "PXPIPE status request failed", loading: false };
  }
}

export function getPxpipeStatusView(status = {}, health = null) {
  const error = typeof status.error === "string" && status.error.trim()
    ? status.error.trim()
    : null;
  if (error) return { label: "Unavailable", dependencyMissing: false, error };
  if (status.loading) return { label: "Checking…", dependencyMissing: false, error: null };
  if (status.installing) return { label: "Installing…", dependencyMissing: false, error: null };
  if (health?.healthy) return { label: "Healthy", dependencyMissing: false, error: null };
  if (status.running) return { label: "Running", dependencyMissing: false, error: null };
  if (status.installed === true) return { label: "Stopped", dependencyMissing: false, error: null };
  if (status.installed === false) return { label: "Not installed", dependencyMissing: true, error: null };
  return { label: "Unavailable", dependencyMissing: false, error: null };
}
