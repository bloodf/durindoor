import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDER_MODELS_CONFIG, resolveQwenModelsUrl, parseOpenAIStyleModels } from "./modelsConfig.js";
import { applyCodexAccountHeader } from "open-sse/shared/codexAccountId.js";

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (isOpenAICompatibleProvider(connection.provider)) {
      const baseUrl = connection.providerSpecificData?.baseUrl;
      if (!baseUrl) {
        return NextResponse.json({ error: "Missing custom base URL" }, { status: 400 });
      }

      const token = connection.accessToken || connection.apiKey;
      if (!token) {
        return NextResponse.json({ error: "No valid token found" }, { status: 401 });
      }

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: text || res.statusText }, { status: res.status });
      }

      const data = await res.json();
      const models = Array.isArray(data) ? data : (data.data || []);
      return NextResponse.json({ models });
    }

    if (isAnthropicCompatibleProvider(connection.provider)) {
      const baseUrl = connection.providerSpecificData?.baseUrl;
      if (!baseUrl) {
        return NextResponse.json({ error: "Missing custom base URL" }, { status: 400 });
      }

      const token = connection.accessToken || connection.apiKey;
      if (!token) {
        return NextResponse.json({ error: "No valid token found" }, { status: 401 });
      }

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
        method: "GET",
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: text || res.statusText }, { status: res.status });
      }

      const data = await res.json();
      const models = Array.isArray(data) ? data : (data.data || []);
      return NextResponse.json({ models });
    }

    const config = PROVIDER_MODELS_CONFIG[connection.provider];
    if (!config) {
      // Generic fallback for registry providers that declare a modelsFetcher
      // (e.g. Qiniu) but have no hard-coded PROVIDER_MODELS_CONFIG entry.
      const fetcher = AI_PROVIDERS[connection.provider]?.modelsFetcher;
      if (fetcher && typeof fetcher.url === "string") {
        const headers = { "Content-Type": "application/json" };
        if (connection.apiKey) {
          headers.Authorization = `Bearer ${connection.apiKey}`;
        }
        try {
          const response = await fetch(fetcher.url, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) {
            const errorText = await response.text();
            console.log(`Error fetching models from ${connection.provider}:`, errorText);
            return NextResponse.json(
              { error: `Failed to fetch models: ${response.status}` },
              { status: response.status }
            );
          }
          const data = await response.json();
          const models = parseOpenAIStyleModels(data);
          return NextResponse.json({
            provider: connection.provider,
            connectionId: connection.id,
            models,
          });
        } catch (error) {
          console.log(`Error fetching models from ${connection.provider}:`, error.message);
          return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
        }
      }

      return NextResponse.json(
        { error: `Provider ${connection.provider} does not support models listing` },
        { status: 400 }
      );
    }

    // Config-driven custom resolver path (OAuth refresh, non-OpenAI shape, etc.)
    if (typeof config.customResolver === "function") {
      const result = await config.customResolver(connection);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status || 500 });
      }
      return NextResponse.json({ models: result.models || [], warning: result.warning });
    }

    // Get auth token
    const token = connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
    if (!token) {
      return NextResponse.json({ error: "No valid token found" }, { status: 401 });
    }

    // Build request URL
    let url = config.url;
    if (connection.provider === "qwen") {
      url = resolveQwenModelsUrl(connection);
    }
    if (config.authQuery) {
      url += `?${config.authQuery}=${token}`;
    }

    // Build headers
    const headers = { ...config.headers };
    if (config.authHeader && !config.authQuery) {
      headers[config.authHeader] = (config.authPrefix || "") + token;
    }
    if (connection.provider === "codex") {
      applyCodexAccountHeader(headers, connection.providerSpecificData);
    }

    // Make request
    const fetchOptions = {
      method: config.method || "GET",
      headers,
      cache: "no-store",
    };

    if (config.body && config.method === "POST") {
      fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: text || response.statusText }, { status: response.status });
    }

    const data = await response.json();
    const models = config.parseResponse(data);

    return NextResponse.json({ models: models || [] });
  } catch (error) {
    console.error("Error fetching provider models:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
