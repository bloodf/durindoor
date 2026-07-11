"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";

const CATEGORY_FILTERS = [
  { value: "", label: "All free" },
  { value: "noauth", label: "No auth" },
  { value: "freeTier", label: "Free tier" },
  { value: "free", label: "Free" },
  { value: "oauth", label: "OAuth" },
  { value: "apikey", label: "API key" },
];

const CATEGORY_VARIANT = {
  noauth: "success",
  freeTier: "info",
  free: "success",
  oauth: "primary",
  apikey: "default",
};

function Score({ value }) {
  if (value === null || value === undefined) return <span className="text-text-muted">—</span>;
  return <span>{Number(value).toFixed(2)}</span>;
}

export default function FreeProviderRankingsPage() {
  const [category, setCategory] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cat) => {
    setLoading(true);
    setError("");
    try {
      const url = cat ? `/api/free-provider-rankings?category=${cat}` : "/api/free-provider-rankings";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err?.message || "Failed to load rankings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(category);
  }, [category, load]);

  const rankings = data?.rankings || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Free Provider Directory</h1>
        <p className="text-sm text-text-muted">
          Free / no-auth providers, grouped by access type then provider id. Quality scores are shown only when
          model intelligence data exists; otherwise left blank — never fabricated. This is a directory, not a
          quality ranking.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((f) => (
          <Button
            key={f.value || "all"}
            variant={category === f.value ? "primary" : "secondary"}
            size="sm"
            onClick={() => setCategory(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && (
        <Card padding="sm">
          <span className="text-sm text-red-500">{error}</span>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 w-10">#</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Models</th>
                <th className="py-2 pr-4">Top model</th>
                <th className="py-2 pr-4">Avg score</th>
                <th className="py-2 pr-4">Elo</th>
                <th className="py-2">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {loading && rankings.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-text-muted">Loading…</td></tr>
              )}
              {!loading && rankings.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-text-muted">No providers match this filter.</td></tr>
              )}
              {rankings.map((r, i) => (
                <tr key={r.id} className="border-b border-border-subtle/50">
                  <td className="py-2 pr-4 text-text-muted">{i + 1}</td>
                  <td className="py-2 pr-4 font-medium">{r.name || r.id}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={CATEGORY_VARIANT[r.category] || "default"} size="sm">
                      {r.category}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4">{r.modelCount ?? 0}</td>
                  <td className="py-2 pr-4 text-text-muted">{r.topModel?.modelName || "—"}</td>
                  <td className="py-2 pr-4"><Score value={r.averageScore} /></td>
                  <td className="py-2 pr-4"><Score value={r.topModel?.eloRaw} /></td>
                  <td className="py-2"><span className="text-text-muted">{r.topModel?.confidence || "—"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
