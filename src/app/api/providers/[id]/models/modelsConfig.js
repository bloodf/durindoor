import { refreshGoogleToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { extractKimiJwt } from "@/lib/providers/webCookieAuth";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveKimchiModels } from "open-sse/services/kimchiModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

export const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

export const parseGeminiCliModels = (data) => {
  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => {
        const id = item?.id || item?.model || item?.name;
        if (!id) return null;
        return { id, name: item?.displayName || item?.name || id };
      })
      .filter(Boolean);
  }

  if (data?.models && typeof data.models === "object") {
    return Object.entries(data.models)
      .filter(([, info]) => !info?.isInternal)
      .map(([id, info]) => ({
        id,
        name: info?.displayName || info?.name || id,
      }));
  }

  return [];
};

export const appendCodexReviewModels = (models) => models.flatMap((model) => {
  const id = model?.id || model?.slug || model?.model || model?.name;
  if (!id) return [];
  const name = model?.display_name || model?.displayName || model?.name || id;
  const normalized = { ...model, id, name };
  const isChatModel = (model?.type || "llm") !== "image" && !id.toLowerCase().includes("embed");
  if (!isChatModel || id.endsWith("-review")) return [normalized];
  return [
    normalized,
    {
      ...normalized,
      id: `${id}-review`,
      name: `${name} Review`,
      upstreamModelId: id,
      quotaFamily: "review",
    },
  ];
});

export const parseCodexModels = (data) => appendCodexReviewModels(parseOpenAIStyleModels(data));

export const createOpenAIModelsConfig = (url) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels
});

export const resolveQwenModelsUrl = (connection) => {
  const fallback = "https://portal.qwen.ai/v1/models";
  const raw = connection?.providerSpecificData?.resourceUrl;
  if (!raw || typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return `${value.replace(/\/$/, "")}/models`;
  }
  return `https://${value.replace(/\/$/, "")}/v1/models`;
};

export const getStaticProviderModels = (providerId) =>
  getModelsByProviderId(providerId).map((model) => ({
    ...model,
    id: model.id,
    name: model.name || model.id,
  }));

export const buildOAuthResolver = ({ refreshFn, fetchFn, parseFn, errorLabel }) =>
  async (connection, proxyOptions = null) => {
    const { accessToken, refreshToken } = connection;
    if (!accessToken) {
      return { error: "No valid token found", status: 401 };
    }
    let warning;
    try {
      let response = await fetchFn(accessToken, connection, proxyOptions);
      if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
        const refreshed = await refreshFn(connection, proxyOptions);
        if (refreshed?.accessToken) {
          await updateProviderCredentials(connection.id, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || refreshToken,
            expiresIn: refreshed.expiresIn,
          });
          connection.accessToken = refreshed.accessToken;
          if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
          response = await fetchFn(refreshed.accessToken, connection, proxyOptions);
        }
      }
      if (response.ok) {
        const data = await response.json();
        const models = parseFn(data);
        if (models.length > 0) return { models };
      } else {
        const errorText = await response.text();
        const safeError = sanitizeErrorMessage(errorText);
        warning = `${errorLabel}: ${response.status} ${safeError}`;
        console.log(`${errorLabel} (falling back to static):`, safeError);
      }
    } catch (error) {
      const safeError = sanitizeErrorMessage(error?.message);
      warning = `${errorLabel}: ${safeError}`;
      console.log(`${errorLabel} (falling back to static):`, safeError);
    }
    return { models: [], warning };
  };

export const PROVIDER_MODELS_CONFIG = {
  claude: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key",
    parseResponse: (data) => data.models || []
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  // Kimi web discovery uses the same `kimi-auth` JWT as the chat executor.
  // GET returns an empty list, so POST {} is required; headers mirror the
  // www.kimi.com web app (Bearer + Cookie replay, connect-protocol-version).
  "kimi-web": {
    url: "https://www.kimi.com/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels",
    method: "POST",
    headers: { accept: "*/*", "Content-Type": "application/json" },
    body: {},
    buildHeaders: (token) => {
      const jwt = extractKimiJwt(token);
      return {
        accept: "*/*",
        "Content-Type": "application/json",
        "connect-protocol-version": "1",
        Origin: "https://www.kimi.com",
        Referer: "https://www.kimi.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        ...(jwt
          ? {
              Authorization: `Bearer ${jwt}`,
              Cookie: `kimi-auth=${jwt}`,
            }
          : {}),
      };
    },
    parseResponse: (data) => {
      const allowed = new Set(["k2d6", "k2d6-thinking"]);
      const list = data?.availableModels || [];
      return list
        .filter((m) => m.key && allowed.has(m.key))
        .map((m) => ({
          id: m.key,
          name: m.displayName || m.key,
          supportsReasoning: m.thinking === true,
        }));
    },
  },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
    method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseCodexModels
  },
  antigravity: {
    url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    body: {},
    parseResponse: (data) => data.models || []
  },
  github: {
    customResolver: async (connection, proxyOptions = null) => {
      const result = await resolveCopilotModels({
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        providerSpecificData: connection.providerSpecificData || {},
      }, {
        forceRefresh: true,
        includeMetadata: true,
        log: console,
        proxyOptions,
        onCredentialsRefreshed: async (refreshed) => {
          await updateProviderCredentials(connection.id, {
            copilotToken: refreshed.copilotToken,
            copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
            existingProviderSpecificData: connection.providerSpecificData || {},
          });
        },
      });
      if (result?.models?.length) return { models: result.models };
      return {
        models: [],
        warning: "GitHub Copilot returned no live models.",
      };
    },
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },
  alicode: {
    url: "https://coding.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  "alicode-intl": {
    url: "https://coding-intl.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  "volcengine-ark": createOpenAIModelsConfig("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  byteplus: createOpenAIModelsConfig("https://ark.ap-southeast.bytepluses.com/api/coding/v3/models"),
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  perplexity: createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.com/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  bai: createOpenAIModelsConfig("https://api.b.ai/v1/models"),
  ollama: createOpenAIModelsConfig("https://ollama.com/api/tags"),
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"),
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
  "vercel-ai-gateway": createOpenAIModelsConfig("https://ai-gateway.vercel.sh/v1/models"),
  hcnsec: createOpenAIModelsConfig("https://api.hcnsec.cn/v1/models"),
  kimchi: {
    customResolver: async (connection, proxyOptions = null) => {
      const result = await resolveKimchiModels({
        accessToken: connection.accessToken,
        apiKey: connection.apiKey,
        providerSpecificData: connection.providerSpecificData || {},
      }, { forceRefresh: true, log: console, proxyOptions });
      if (result?.models?.length) {
        return { models: result.models };
      }
      return {
        models: getStaticProviderModels("kimchi"),
        warning: "Kimchi returned no live models; falling back to static catalog.",
      };
    }
  },
  kiro: {
    customResolver: async (connection, proxyOptions = null) => {
      const credentials = {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        providerSpecificData: connection.providerSpecificData || {}
      };
      let warning;
      try {
        const result = await resolveKiroModels(credentials, {
          log: console,
          proxyOptions,
          onCredentialsRefreshed: async (refreshed) => {
            if (refreshed?.accessToken) {
              await updateProviderCredentials(connection.id, {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken || connection.refreshToken,
                expiresIn: refreshed.expiresIn,
              });
              connection.accessToken = refreshed.accessToken;
              if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
            }
          }
        });
        if (result?.models?.length) {
          return {
            models: result.models.map((m) => ({
              id: m.id,
              name: m.name,
              upstreamModelId: m.upstreamModelId,
              contextLength: m.contextLength,
              rateMultiplier: m.rateMultiplier,
              capabilities: m.capabilities,
              description: m.description
            }))
          };
        }
        warning = "Kiro returned no models; falling back to static catalog.";
      } catch (error) {
        const safeError = sanitizeErrorMessage(error?.message);
        warning = `Failed to fetch Kiro models: ${safeError}`;
        console.log("Failed to fetch Kiro models dynamically, falling back to static:", safeError);
      }
      return { models: [], warning };
    }
  },
  qoder: {
    customResolver: async (connection, proxyOptions = null) => {
      const credentials = {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        email: connection.email,
        displayName: connection.displayName,
        providerSpecificData: connection.providerSpecificData || {},
      };
      let warning;
      try {
        const result = await resolveQoderModels(credentials, { forceRefresh: true, proxyOptions });
        if (result?.models?.length) {
          return {
            models: result.models.map((m) => ({
              id: `qoder/${m.id}`,
              name: m.name,
              contextLength: m.contextLength,
              isVL: m.isVL,
              isReasoning: m.isReasoning,
              maxOutputTokens: m.maxOutputTokens,
              description: m.description,
            })),
          };
        }
        warning = "Qoder returned no models; falling back to static catalog.";
      } catch (error) {
        const safeError = sanitizeErrorMessage(error?.message);
        warning = `Failed to fetch Qoder models: ${safeError}`;
        console.log("Failed to fetch Qoder models dynamically, falling back to static:", safeError);
      }
      return { models: [], warning };
    },
  },
  "gemini-cli": {
    customResolver: buildOAuthResolver({
      refreshFn: (conn, proxyOptions) => refreshGoogleToken(
        conn.refreshToken,
        process.env.GEMINI_CLIENT_ID,
        process.env.GEMINI_CLIENT_SECRET,
        proxyOptions
      ),
      fetchFn: (token, conn, proxyOptions) => {
        const projectId = conn.projectId || conn.providerSpecificData?.projectId;
        const body = projectId ? { project: projectId } : {};
        return proxyAwareFetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
          },
          body: JSON.stringify(body)
        }, proxyOptions);
      },
      parseFn: parseGeminiCliModels,
      errorLabel: "Failed to fetch Gemini CLI models"
    })
  },
  agy: {
    customResolver: buildOAuthResolver({
      refreshFn: (conn, proxyOptions) => refreshGoogleToken(
        conn.refreshToken,
        process.env.AGY_CLIENT_ID,
        process.env.AGY_CLIENT_SECRET,
        proxyOptions
      ),
      fetchFn: (token, conn, proxyOptions) => {
        const projectId = conn.projectId || conn.providerSpecificData?.projectId;
        const body = projectId ? { project: projectId } : {};
        return proxyAwareFetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1 vscode-antigravity/1.107.0",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
          },
          body: JSON.stringify(body)
        }, proxyOptions);
      },
      parseFn: parseGeminiCliModels,
      errorLabel: "Failed to fetch Antigravity CLI models"
    })
  },
  "ollama-local": {
    customResolver: async (connection, proxyOptions = null) => {
      const url = `${resolveOllamaLocalHost(connection)}/api/tags`;
      const response = await proxyAwareFetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      }, proxyOptions);
      if (!response.ok) {
        const errorText = await response.text();
        console.log("Error fetching models from ollama-local:", sanitizeErrorMessage(errorText));
        return { error: `Failed to fetch models: ${response.status}`, status: response.status };
      }
      const data = await response.json();
      return { models: parseOpenAIStyleModels(data) };
    }
  }
};
