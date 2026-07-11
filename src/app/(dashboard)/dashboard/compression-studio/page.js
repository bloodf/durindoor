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
        body: input,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || `Preview failed (${res.status})`);
        return;
      }
      setEngines(Array.isArray(data.engines) ? data.engines : []);
      setResults(data.results || {});
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Compression Studio</h1>
      <p className="text-sm text-gray-500">
        Preview how each compression engine would transform a request body.
      </p>

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
                </tr>
              </thead>
              <tbody>
                {engines.map((id) => {
                  const r = results[id] || {};
                  const unavailable = r.status === "unavailable";
                  const errored = r.status === "error";
                  return (
                    <tr key={id} className="border-b last:border-0">
                      <td className="py-2 font-mono">{id}</td>
                      <td className="py-2">
                        {unavailable ? "unavailable" : errored ? "error" : r.compressed ? "yes" : "no"}
                      </td>
                      <td className="py-2">
                        {unavailable || errored ? "—" : `${Number(r.savingsPercent || 0).toFixed(2)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
