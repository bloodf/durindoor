"use client";

import { useState } from "react";
import { Card, Button } from "@/shared/components";

export default function CompressionStudioPage() {
  const [input, setInput] = useState(
    '{\n  "model": "openai/gpt-4o",\n  "messages": [\n    { "role": "user", "content": "hello" }\n  ]\n}'
  );
  const [results, setResults] = useState(null);
  const [engines, setEngines] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rawOpen, setRawOpen] = useState({});

  const runPreview = async () => {
    setLoading(true);
    setError("");
    setResults(null);
    try {
      JSON.parse(input);
    } catch {
      setLoading(false);
      setError("Input is not valid JSON.");
      return;
    }

    try {
      const res = await fetch("/api/compression/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(JSON.parse(input)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Preview failed (${res.status})`);
      }
      const data = await res.json();
      setEngines(Array.isArray(data.engines) ? data.engines : []);
      setResults(data.results || {});
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleRaw = (id) => {
    setRawOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Compression Studio</h1>
        <p className="text-sm text-gray-500">
          Preview how each compression engine would transform a request body.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <label className="block text-sm font-medium" htmlFor="compression-input">
          Request body (JSON)
        </label>
        <textarea
          id="compression-input"
          className="w-full h-56 font-mono text-sm p-3 border rounded-md bg-transparent"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
        <Button onClick={runPreview} disabled={loading}>
          {loading ? "Running…" : "Run preview"}
        </Button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </Card>

      {results && (
        <Card className="p-4">
          <h2 className="text-lg font-medium mb-3">Results</h2>
          {engines.length === 0 ? (
            <p className="text-sm text-gray-500">No engines reported.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Engine</th>
                  <th className="py-2">Compressed</th>
                  <th className="py-2">Est. savings</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {engines.map((id) => {
                  const r = results[id] || {};
                  const unavailable = r.status === "unavailable";
                  const errored = r.status === "error";
                  const raw = r.raw ?? r.compressedBody;
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="py-2 font-mono">{id}</td>
                      <td className="py-2">
                        {unavailable ? "unavailable" : errored ? "error" : r.compressed ? "yes" : "no"}
                      </td>
                      <td className="py-2">
                        {unavailable || errored ? "—" : `${Number(r.savingsPercent || 0).toFixed(2)}%`}
                      </td>
                      <td className="py-2 text-right">
                        {!unavailable && !errored && raw !== undefined && (
                          <button
                            type="button"
                            onClick={() => toggleRaw(id)}
                            className="text-xs text-primary underline hover:opacity-80"
                          >
                            {rawOpen[id] ? "Hide raw JSON" : "Show raw JSON"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {Object.entries(rawOpen)
            .filter(([, open]) => open)
            .map(([id]) => {
              const r = results[id] || {};
              const raw = r.raw ?? r.compressedBody;
              return (
                <div key={`${id}-raw`} className="mt-3">
                  <p className="text-xs font-semibold text-text-muted mb-1">{id} raw output</p>
                  <pre className="w-full h-40 font-mono text-xs p-3 rounded-md border bg-black/5 dark:bg-white/5 overflow-auto">
                    {typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)}
                  </pre>
                </div>
              );
            })}
        </Card>
      )}
    </div>
  );
}
