"use client";

import { useState } from "react";

export default function AutoConfigureClient({ status }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/auto-configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReport(data.report);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Auto-configure</h1>
      </div>

      <p className="text-gray-300">
        One-click setup for Headroom, PxPipe, Firecrawl, and built-in toggles.
      </p>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          Dry run (preview only)
        </label>

        <button
          onClick={run}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Running..." : "Run auto-configure"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-900/30 p-4 text-red-200">
          {error}
        </div>
      )}

      {status && !report && (
        <div className="rounded border border-gray-700 bg-gray-800/50 p-4">
          <h2 className="mb-2 font-semibold">Status</h2>
          <pre className="max-h-96 overflow-auto rounded bg-gray-900 p-3 text-sm">
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      )}

      {report && (
        <div className="rounded border border-gray-700 bg-gray-800/50 p-4">
          <h2 className="mb-2 font-semibold">
            {report.dryRun ? "Dry run result" : "Result"} — changed: {String(report.changed)}
          </h2>
          <pre className="max-h-96 overflow-auto rounded bg-gray-900 p-3 text-sm">
            {JSON.stringify(report, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
