import { useEffect, useRef } from "react";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { sanitizeErrorText } from "@/lib/playground/errors";
import { getProviderLabel, groupModelsByProvider, normalizeLiveModel, normalizeStaticModel } from "./playgroundHelpers";
import { parseProviderModelsPayload } from "./playgroundSessionHelpers";

// Keep discovery cancellation scoped to the mounted playground.
export function usePlaygroundDiscovery(setProviderGroups, setLoadingData, setLoadError) {
  const loadAbortRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const providersRes = await fetch("/api/providers", { cache: "no-store", signal: controller.signal });
        const providersData = await providersRes.json().catch(() => ({}));
        const connections = Array.isArray(providersData.connections) ?
        providersData.connections.filter((connection) => connection?.isActive !== false) :
        [];

        if (connections.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No providers connected yet.");
          }
          return;
        }

        const liveResults = await Promise.all(
          connections.map(async (connection) => {
            if (!connection || connection.canDiscoverModels === false) {
              return { connection, models: [] };
            }
            try {
              const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store", signal: controller.signal });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) return { connection, models: [] };
              const models = parseProviderModelsPayload(data).
              map((model) => normalizeLiveModel(model, connection)).
              filter(Boolean);
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        const normalizedConnections = connections.map((connection) => {
          const providerId = connection.provider || connection.id;
          return {
            ...connection,
            provider: connection.provider || connection.id,
            providerId,
            providerName: getProviderLabel(connection),
            providerType: isOpenAICompatibleProvider(providerId) ?
            "openai-compatible" :
            isAnthropicCompatibleProvider(providerId) ?
            "anthropic-compatible" :
            providerId
          };
        });

        const normalizedModels = [
        ...normalizedConnections.flatMap((connection) =>
        getModelsByProviderId(connection.providerId).
        map((model) => normalizeStaticModel(model, connection)).
        filter(Boolean)
        ),
        ...liveResults.flatMap((result) => result.models || [])];


        const normalized = groupModelsByProvider(normalizedConnections, normalizedModels);

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError("Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!cancelled) {
          setLoadError(sanitizeErrorText(error?.message) || "Failed to load providers/models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
      controller.abort();
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
    };
  }, []);

}
