import {
  getProviderConnections,
  getProviderConnectionById,
  updateProviderConnection,
  getProviderNodeById } from
"@/models";
import {
  getCombos,
  getComboById,
  getApiKeys,
  getAllApiKeyUsageTotals,
  listProviderQuotaSnapshots,
  getSettings,
  updateSettings } from
"@/lib/localDb";
import {
  createComboManaged,
  updateComboManaged,
  deleteComboManaged } from
"@/lib/combos/comboManagement";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import { toApiKeyManagementView } from "@/shared/utils/apiKeyManagement";
import { redactProxyUrlCredentials } from "@/shared/utils/proxyUrlRedaction.js";
import {
  AUTH_CRITICAL_SETTING_KEYS,
  SECRET_SETTING_KEYS,
  stripSettingKeys } from
"@/lib/settings/settingsPatchAuth";
import { buildModelsList, LLM_KIND } from "@/app/api/v1/models/buildModelsList";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { VALID_USAGE_STATS_PERIODS } from "@/lib/usagePeriods.js";
import {
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider } from
"@/shared/constants/providers";
import { notifyQuotaAutoPingSettingChanged } from "@/shared/services/quotaAutoPing";
import { sanitizeProviderConnectionForClient } from "@/lib/providers/sanitizeProviderConnectionForClient.js";
import { getUsageStats, getTokenSaverStats } from "@/lib/usageDb";
import { isBoolean, isObject, isString } from "../../../shared/utils/typeChecks.js";

/**
 * Service kinds `buildModelsList` understands. Mirrors LLM_KIND plus the
 * MODEL_TYPE_TO_KIND values in buildModelsList.js, which are not exported.
 */
const MODEL_KINDS = Object.freeze([
  LLM_KIND,
  "image",
  "tts",
  "embedding",
  "stt",
  "imageToText",
  "rerank",
  "video"
]);

/** Auto-ping settings are connection-scoped; the flat PATCH surface rejects them. */
const SCOPED_SETTING_KEYS = ["claudeAutoPing", "codexAutoPing"];

function toolError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Strip the same secrets `GET /api/settings` withholds from the dashboard, and
 * redact proxy userinfo: the MCP control surface authenticates with an
 * application API key, which is never an operator session.
 */
function sanitizeSettings(settings) {
  const { password, passwordSessionEpoch, oidcClientSecret, mitmSudoEncrypted, ...safe } = settings ?? {};
  if (safe.outboundProxyUrl) {
    safe.outboundProxyUrl = redactProxyUrlCredentials(safe.outboundProxyUrl);
  }
  return safe;
}

function sanitizeConnection(c) {
  const safe = sanitizeProviderConnectionForClient(c);
  // connectionProxyUrl can contain proxy credentials in formats not all safely
  // parsable; omit it from the MCP control surface.
  if (safe.providerSpecificData?.connectionProxyUrl !== undefined) {
    const { connectionProxyUrl, ...rest } = safe.providerSpecificData;
    safe.providerSpecificData = rest;
  }
  return safe;
}

async function isValidProviderId(providerId) {
  if (!isString(providerId) || providerId.length === 0) return false;
  if (AI_PROVIDERS[providerId] != null) return true;
  if (
  isOpenAICompatibleProvider(providerId) ||
  isAnthropicCompatibleProvider(providerId) ||
  isCustomEmbeddingProvider(providerId))
  {
    const node = await getProviderNodeById(providerId);
    return node != null;
  }
  return false;
}

function assertString(value, field) {
  if (!isString(value) || value.length === 0) {
    const err = new Error(`Invalid ${field}: expected non-empty string`);
    err.status = 400;
    throw err;
  }
}

function assertBoolean(value, field) {
  if (!isBoolean(value)) {
    const err = new Error(`Invalid ${field}: expected boolean`);
    err.status = 400;
    throw err;
  }
}

function assertValidPeriod(period) {
  if (!VALID_USAGE_STATS_PERIODS.has(period)) {
    const err = new Error(`Invalid period: ${period}`);
    err.status = 400;
    throw err;
  }
}

const TOOLS = {
  list_providers: {
    description: "List built-in AI providers and their registry metadata",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const providers = Object.values(AI_PROVIDERS).map((p) => ({
        id: p.id,
        alias: p.alias,
        name: p.name || p.alias,
        category: p.category,
        authType: p.authType
      }));
      return { providers };
    }
  },

  list_connections: {
    description: "List all configured provider connections without credentials",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const connections = await getProviderConnections();
      return { connections: connections.map(sanitizeConnection) };
    }
  },

  toggle_connection_active: {
    description: "Enable or disable a single provider connection by ID",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        isActive: { type: "boolean" }
      },
      required: ["connectionId", "isActive"]
    },
    handler: async (args) => {
      assertString(args.connectionId, "connectionId");
      assertBoolean(args.isActive, "isActive");
      const existing = await getProviderConnectionById(args.connectionId);
      if (!existing) {
        const err = new Error("Connection not found");
        err.status = 404;
        throw err;
      }
      const updated = await updateProviderConnection(args.connectionId, { isActive: args.isActive });
      if (args.isActive === false) {
        notifyQuotaAutoPingSettingChanged(existing.provider, args.connectionId, false);
      }
      return { connection: sanitizeConnection(updated) };
    }
  },

  toggle_provider_active: {
    description: "Enable or disable every connection for a provider ID",
    inputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        isActive: { type: "boolean" }
      },
      required: ["providerId", "isActive"]
    },
    handler: async (args) => {
      assertString(args.providerId, "providerId");
      assertBoolean(args.isActive, "isActive");
      if (!(await isValidProviderId(args.providerId))) {
        const err = new Error(`Unknown provider: ${args.providerId}`);
        err.status = 400;
        throw err;
      }
      const connections = await getProviderConnections({ provider: args.providerId });
      if (connections.length === 0) {
        const err = new Error(`No connections found for provider: ${args.providerId}`);
        err.status = 404;
        throw err;
      }
      const results = [];
      for (const c of connections) {
        const updated = await updateProviderConnection(c.id, { isActive: args.isActive });
        if (args.isActive === false) {
          notifyQuotaAutoPingSettingChanged(args.providerId, c.id, false);
        }
        results.push(sanitizeConnection(updated));
      }
      return { connections: results };
    }
  },

  usage_stats: {
    description: "Return aggregate usage statistics for a time period",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...VALID_USAGE_STATS_PERIODS] }
      },
      required: ["period"]
    },
    handler: async (args) => {
      assertString(args.period, "period");
      assertValidPeriod(args.period);
      const stats = await getUsageStats(args.period);
      return { stats };
    }
  },

  token_saver_stats: {
    description: "Return token-saver statistics for a time period",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...VALID_USAGE_STATS_PERIODS] }
      },
      required: ["period"]
    },
    handler: async (args) => {
      assertString(args.period, "period");
      assertValidPeriod(args.period);
      const stats = await getTokenSaverStats(args.period);
      return { stats };
    }
  },

  model_list: {
    description: "List available models in OpenAI-compatible format, optionally filtered by service kind",
    inputSchema: {
      type: "object",
      properties: {
        kinds: { type: "array", items: { type: "string", enum: [...MODEL_KINDS] } }
      },
      required: []
    },
    handler: async (args) => {
      let kinds = [LLM_KIND];
      if (args.kinds !== undefined) {
        if (!Array.isArray(args.kinds) || args.kinds.length === 0) {
          throw toolError("Invalid kinds: expected non-empty array of service kinds", 400);
        }
        const unknown = args.kinds.find((kind) => !MODEL_KINDS.includes(kind));
        if (unknown !== undefined) throw toolError(`Invalid kind: ${unknown}`, 400);
        kinds = args.kinds;
      }
      const models = await buildModelsList(kinds, getProviderValidationGuard());
      return { models };
    }
  },

  list_combos: {
    description: "List every configured combo (virtual multi-provider model)",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      return { combos: await getCombos() };
    }
  },

  get_combo: {
    description: "Fetch a single combo by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    },
    handler: async (args) => {
      assertString(args.id, "id");
      const combo = await getComboById(args.id);
      if (!combo) throw toolError("Combo not found", 404);
      return { combo };
    }
  },

  create_combo: {
    description: "Create a combo from a name plus its models, members, kind, capabilities and connection allowlist",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        models: { type: "array", items: { type: "string" } },
        members: { type: "array" },
        kind: { type: "string" },
        capabilities: { type: "object" },
        allowedConnectionIds: { type: "array", items: { type: "string" } }
      },
      required: ["name"]
    },
    handler: async (args) => {
      assertString(args.name, "name");
      return { combo: await createComboManaged(args) };
    }
  },

  update_combo: {
    description: "Update a combo; omitted fields keep their stored value",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        models: { type: "array", items: { type: "string" } },
        members: { type: "array" },
        kind: { type: "string" },
        capabilities: { type: "object" },
        allowedConnectionIds: { type: "array", items: { type: "string" } }
      },
      required: ["id"]
    },
    handler: async (args) => {
      assertString(args.id, "id");
      const { id, ...patch } = args;
      return { combo: await updateComboManaged(id, patch) };
    }
  },

  delete_combo: {
    description: "Delete a combo by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    },
    handler: async (args) => {
      assertString(args.id, "id");
      return await deleteComboManaged(args.id);
    }
  },

  quota_snapshots: {
    description: "Read provider-reported quota/allowance snapshots for a provider or connection",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        connectionId: { type: "string" },
        includeStale: { type: "boolean" }
      },
      required: []
    },
    handler: async (args) => {
      if (args.provider === undefined && args.connectionId === undefined) {
        throw toolError("A connectionId or provider filter is required", 400);
      }
      if (args.provider !== undefined) assertString(args.provider, "provider");
      if (args.connectionId !== undefined) assertString(args.connectionId, "connectionId");
      const snapshots = await listProviderQuotaSnapshots({
        provider: args.provider,
        connectionId: args.connectionId,
        includeStale: args.includeStale === true
      });
      return { snapshots };
    }
  },

  refresh_quota: {
    description: "Force a live quota refresh for one connection and return the resulting snapshots",
    inputSchema: {
      type: "object",
      properties: { connectionId: { type: "string" } },
      required: ["connectionId"]
    },
    handler: async (args) => {
      assertString(args.connectionId, "connectionId");
      const connection = await getProviderConnectionById(args.connectionId);
      if (!connection) throw toolError("Connection not found", 404);
      let result;
      try {
        result = await refreshProviderQuota(connection, { force: true });
      } catch (error) {
        // Providers without a quota endpoint (or a rejected shape) are a
        // caller-visible condition, not a server fault.
        throw toolError(error?.message || "Quota refresh failed", 400);
      }
      const snapshots = await listProviderQuotaSnapshots({
        connectionId: args.connectionId,
        provider: connection.provider,
        includeStale: true
      });
      return { result, snapshots };
    }
  },

  list_api_keys: {
    description: "List DurinDoor API keys with usage totals; raw secrets are never returned",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const [keys, totals] = await Promise.all([getApiKeys(), getAllApiKeyUsageTotals()]);
      const totalsById = new Map(totals.map((usage) => [usage.apiKeyId, usage]));
      return {
        keys: keys.map((key) => ({
          ...toApiKeyManagementView(key),
          usage: totalsById.get(key.id) || { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null }
        }))
      };
    }
  },

  get_settings: {
    description: "Read DurinDoor settings with secrets withheld",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      return { settings: sanitizeSettings(await getSettings()) };
    }
  },

  update_settings: {
    description: "Update non-secret, non-auth-critical DurinDoor settings",
    inputSchema: {
      type: "object",
      properties: { settings: { type: "object" } },
      required: ["settings"]
    },
    handler: async (args) => {
      if (!isObject(args.settings) || Array.isArray(args.settings)) {
        throw toolError("Invalid settings: expected object", 400);
      }
      const patch = { ...args.settings };
      // MCP callers authenticate with an API key, which never qualifies for
      // auth-critical settings (canModifySecurityCriticalSettings demands a
      // dashboard JWT or CLI token bound to a live request). Auto-ping keys
      // are connection-scoped and rejected by the REST surface too.
      stripSettingKeys(patch, SECRET_SETTING_KEYS);
      stripSettingKeys(patch, AUTH_CRITICAL_SETTING_KEYS);
      stripSettingKeys(patch, SCOPED_SETTING_KEYS);
      if (Object.keys(patch).length === 0) {
        throw toolError("No updatable settings provided", 400);
      }
      await updateSettings(patch);
      return { settings: sanitizeSettings(await getSettings()) };
    }
  }
};

export function listTools() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

export async function callTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`);
    err.status = 404;
    throw err;
  }
  return await tool.handler(args ?? {});
}

export { TOOLS };