"use client";

/** Keeps ProviderAutoSync requests and handlers together. */
export default function useProviderAutoSync({ connections, providerGenerationRef, setCatalogEvidence, setModelsFetchedAt, setSuggestedModels, setSyncingModels }) {
  const handleSyncModels = async () => {
    const requestGeneration = providerGenerationRef.current;
    const connection = connections.find((item) => item.isActive !== false);
    if (!connection?.id) return;

    setSyncingModels(true);
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/models?refresh=1`, {
        cache: "no-store"
      });
      const data = await response.json();
      if (providerGenerationRef.current !== requestGeneration) return;
      if (!response.ok) { alert(data.error || "Failed to fetch models"); return; }
      setSuggestedModels(Array.isArray(data?.models) ? data.models : []);
      setCatalogEvidence(data ? { source: data.source, degraded: data.degraded } : null);
      setModelsFetchedAt(new Date());
    } finally {
      if (providerGenerationRef.current === requestGeneration) setSyncingModels(false);
    }
  };

  return { handleSyncModels };
}
