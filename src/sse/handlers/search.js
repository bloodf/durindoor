import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getProviderCredentialsWithQuotaPreflight,
  getNoAuthProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  resolveClientApiKey } from
"../services/auth.js";
import { getSettings, getCombos, getComboForModel, getApiKeyByKey } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { handleSearchCore } from "open-sse/handlers/search/index.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat, getComboModelsFromData } from "open-sse/services/combo.js";
import { getAutoComboCatalog } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { filterPaidModels } from "open-sse/providers/pricing.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { getComboRoutingPolicy } from "open-sse/services/comboRoutingPolicy.js";

/**
 * Handle web search request for the SSE/Next.js server.
 * Provider IS the model (no model field). Mirrors handleEmbeddings auth + fallback flow.
 *
 * @param {Request} request
 */
import { isString } from "../../shared/utils/typeChecks.js";
async function handleSearchHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("SEARCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  // Accept either `provider` or `model` (UI sends `model` since provider IS the model for webSearch)
  const providerInput = normalizeSearchProviderInput(body.provider || body.model);
  const query = body.query;

  log.request("POST", `${url.pathname} | ${providerInput}`);

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true
  });
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (!apiKeyAuth.ok) {
    if (apiKeyAuth.reason === "missing") {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    log.warn("AUTH", "Invalid API key");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!providerInput || !isString(providerInput)) {
    log.warn("SEARCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }

  if (!query || !isString(query) || !query.trim()) {
    log.warn("SEARCH", "Missing query");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  }

  // Per-key combo access control. Auto-combo catalog computed lazily — only
  // for `auto/<family>` ids — so named-combo traffic keeps its current DB cost.
  const autoCatalog = isAutoComboId(providerInput) ? await getAutoComboCatalog() : null;
  const autoOptions = autoCatalog ? { catalog: autoCatalog, settings } : { settings };
  if (apiKey && providerInput) {
    const keyData = await getApiKeyByKey(apiKey);
    if (keyData && Array.isArray(keyData.allowedCombos) && keyData.allowedCombos.length > 0) {
      const combosData = await getCombos();
      const isCombo = getComboModelsFromData(providerInput, combosData, autoOptions);
      if (isCombo && !keyData.allowedCombos.includes(providerInput)) {
        log.warn("AUTH", `API key "${keyData.name}" not allowed to access combo "${providerInput}"`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: combo "${providerInput}" is not allowed for this API key`);
      }
    }
  }

  // Combo expansion: providerInput may be a combo name → run fallback/round-robin across providers
  const combos = await getCombos();
  // #6495 / F-4: filter paid members when the toggle is on. The auth ACL check
  // above calls getComboModelsFromData without filtering so combo existence/ACL
  // stay against the real member list.
  const comboModels = filterPaidModels(
    getComboModelsFromData(providerInput, combos, autoOptions),
    settings.hidePaidModels === true
  );
  if (comboModels) {
    const combo = isAutoComboId(providerInput) ? null : await getComboForModel(providerInput);
    const comboName = combo?.name || providerInput;
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[comboName] || {};
    const comboSpecificStrategy = isAutoComboId(providerInput) ?
    perCombo.strategy ?? perCombo.fallbackStrategy :
    perCombo.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboRouting = await getComboRoutingPolicy(comboName);
    log.info("SEARCH", `Combo "${comboName}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleProviderSearch(b, m, request, apiKey, apiKeyAuth.apiKeyId, settings, comboRouting),
      log,
      comboName,
      comboStrategy,
      comboStickyLimit,
      comboMembers: combo?.members || []
    });
  }
  return handleSingleProviderSearch(body, providerInput, request, apiKey, apiKeyAuth.apiKeyId, settings);
}

async function handleSingleProviderSearch(body, providerInput, request, apiKey, apiKeyId, settings, comboRouting = null) {
  const query = body.query;
  const providerId = resolveProviderId(providerInput);
  const resolvedProvider = AI_PROVIDERS[providerId];

  if (!resolvedProvider) {
    log.warn("SEARCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }

  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${providerId}/search`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;

  const providerConfig = resolvedProvider.searchConfig;
  const supportsSearch = !!providerConfig || !!resolvedProvider.searchViaChat;

  if (!supportsSearch) {
    log.warn("SEARCH", "Provider does not support web search", { provider: providerId });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${providerId} does not support web search`);
  }

  if (providerInput !== providerId) {
    log.info("ROUTING", `${providerInput} → ${providerId}`);
  } else {
    log.info("ROUTING", `Provider: ${providerId}`);
  }

  // Sanitized body forwarded to core
  const coreBody = {
    query: query.trim(),
    provider: providerId,
    max_results: body.max_results,
    search_type: body.search_type,
    country: body.country,
    language: body.language,
    time_range: body.time_range,
    offset: body.offset,
    domain_filter: body.domain_filter,
    content_options: body.content_options,
    provider_options: body.provider_options
  };

  // No-auth execution still resolves provider-account scope first.
  if (resolvedProvider.noAuth) {
    const credentials = await getNoAuthProviderCredentials(providerId, null, {
      apiKeyId,
      allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
      restrictionApplied: comboRouting?.restrictionApplied === true
    });
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${providerId}' is disabled. Enable it in Settings > Providers.`);
      }
      return errorResponse(
        credentials?.allRateLimited ? Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
        credentials?.lastError || `No credentials for provider: ${providerId}`,
      );
    }
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: credentials.connectionId ? credentials : null,
      log
    });
    if (result.success) {
      const usage = result.data?.usage || {};
      return recordApiKeyUsageForResponse(apiKey, result.response, {
        tokens: Number(usage.llm_tokens) || String(query).length / 4,
        cost: Number(usage.search_cost_usd) || 0
      });
    }
    return result.response;
  }

  // Credential + fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentialsWithQuotaPreflight(providerId, excludeConnectionIds, null, {
      apiKeyId,
      allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
      restrictionApplied: comboRouting?.restrictionApplied === true
    });

    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        log.warn("SEARCH", `[${providerId}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${providerId}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SEARCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${providerId}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("SEARCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);

    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials);
      }
    });

    if (result.success) {
      const usage = result.data?.usage || {};
      return recordApiKeyUsageForResponse(apiKey, result.response, {
        tokens: Number(usage.llm_tokens) || String(query).length / 4,
        cost: Number(usage.search_cost_usd) || 0
      });
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, providerId);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

/** Normalize advertised `<alias>/search` model IDs to their provider alias. */
export function normalizeSearchProviderInput(providerInput) {
  if (!isString(providerInput) || !providerInput.endsWith("/search")) return providerInput;
  const stripped = providerInput.slice(0, -"/search".length);
  const rawProvider = AI_PROVIDERS[resolveProviderId(providerInput)];
  const strippedProvider = AI_PROVIDERS[resolveProviderId(stripped)];
  if (!rawProvider?.searchConfig && !rawProvider?.searchViaChat && (strippedProvider?.searchConfig || strippedProvider?.searchViaChat)) {
    return stripped;
  }
  return providerInput;
}
export const handleSearch = withRequestCorrelation(handleSearchHandler);
