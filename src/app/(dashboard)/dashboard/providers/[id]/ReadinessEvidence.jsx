"use client";

import api from "@/shared/utils/api.js";
import { useEffect, useState } from "react";

// Only local readiness is fetched; this never validates credentials or runs inference.
export default function ReadinessEvidence({ providerId }) {
  const [state, setState] = useState({ providerId, status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ providerId, status: "loading" });
    api.get(`/api/providers/${encodeURIComponent(providerId)}/readiness`, { cache: "no-store", signal: controller.signal, defaultHeaders: false })
      .then((data) => {
        if (!controller.signal.aborted) setState({ providerId, status: "loaded", data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ providerId, status: "error" });
      });
    return () => controller.abort();
  }, [providerId]);

  if (state.providerId !== providerId || state.status === "loading") return <p role="status">Loading local readiness evidence…</p>;
  if (state.status === "error") return <p role="status">Readiness evidence unavailable. Catalog, dispatch, authentication and inference are unknown.</p>;
  return <ReadinessEvidenceDetails data={state.data} />;
}

export function ReadinessEvidenceDetails({ data }) {
  const catalog = data?.catalog === "LISTED" ? "Listed" : data?.catalog === "NOT_LISTED" ? "Not listed" : "Unknown";
  const dispatch = data?.chatDispatch === "CONFIGURED" ? "Configured, not verified" : data?.chatDispatch === "UNSUPPORTED" ? "Unsupported" : "Unknown";
  const kinds = Array.isArray(data?.nativeKinds) ? data.nativeKinds : [];
  return (
    <div aria-label="Local API readiness evidence" className="mt-3 border-t border-dd-border pt-3">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-dd-muted">Catalog metadata</dt><dd>{catalog}</dd></div>
        <div><dt className="text-dd-muted">Chat executor or transport</dt><dd>{dispatch}</dd></div>
        <div><dt className="text-dd-muted">Authenticated validation</dt><dd>Unknown — no fresh timestamped evidence</dd></div>
        <div><dt className="text-dd-muted">Actual inference</dt><dd>Unknown — no account, model and operation-bound evidence</dd></div>
      </dl>
      <p className="mt-2 text-dd-muted">Configured native operation kinds: {kinds.join(", ") || "none reported"}. Unlisted native operations are unsupported on the native route; other gateway routes may exist. Model, modality and tool support are not established by this list.</p>
      <p className="mt-2 text-dd-muted">Missing or stale evidence cannot establish current authentication or inference. Configuration does not prove a live request works.</p>
    </div>
  );
}
