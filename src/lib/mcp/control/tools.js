import {
  getProviderConnections,
  getProviderConnectionById,
  updateProviderConnection,
  getProviderNodeById } from
"@/models";
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
import { isBoolean, isString } from "../../../shared/utils/typeChecks.js";

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
    description: "List available LLM models in OpenAI-compatible format",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const models = await buildModelsList([LLM_KIND], getProviderValidationGuard());
      return { models };
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