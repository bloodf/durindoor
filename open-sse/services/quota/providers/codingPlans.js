import { createHash } from "node:crypto";
import {
  asArray,
  asRecord,
  boundedQuotaRow,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaPercent,
  quotaRow,
  quotaScopedKey,
  ratioQuotaRow,
  remainingQuotaRow } from
"../normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  futureResetAt,
  missingCredential,
  providerFailure,
  providerSuccess } from
"../providerHelpers.js";
import { isBoolean, isString } from "../../../../src/shared/utils/typeChecks.js";

function safePlan(value, fallback = null) {
  return isString(value) && value.trim() ? value.trim() : fallback;
}

function stableDeviceId(provider, connection) {
  const existing = connectionData(connection).deviceId;
  if (isString(existing) && /^[A-Za-z0-9._:-]{1,128}$/.test(existing.trim())) return existing.trim();
  return createHash("sha256").update(provider).update("\0").update(String(connection?.id || "connection")).digest("hex").slice(0, 32);
}

// ─── Kimi Coding ────────────────────────────────────────────────────────────

const KIMI_PLANS = Object.freeze({
  LEVEL_BASIC: "Moderato",
  LEVEL_INTERMEDIATE: "Allegretto",
  LEVEL_ADVANCED: "Allegro",
  LEVEL_STANDARD: "Vivace"
});

export function normalizeKimiQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const level = data.user?.membership?.level;
  const plan = KIMI_PLANS[level] || (isString(level) ? level.replace(/^LEVEL_/, "").toLowerCase() : "Kimi Coding");
  const rows = [];
  const hasUsage = Object.hasOwn(data, "usage");
  const usage = asRecord(data.usage);
  if (hasUsage && !usage) return null;
  if (usage) {
    const limit = finiteQuotaNumber(usage.limit ?? usage.Limit);
    const used = finiteQuotaNumber(usage.used ?? usage.Used);
    const remaining = finiteQuotaNumber(usage.remaining ?? usage.Remaining);
    if (limit === null || used === null || remaining === null || Math.abs(Math.max(limit - used, 0) - remaining) > Math.max(1e-9, limit * 1e-9)) return null;
    const row = boundedQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", "weekly"),
      limit,
      used,
      remaining,
      unit: "requests",
      resetAt: futureResetAt(parseQuotaTimestamp(usage.resetTime ?? usage.ResetTime ?? usage.reset_at ?? usage.resetAt), now),
      metadata: quotaMetadata({ plan, windowSeconds: 7 * 24 * 60 * 60 })
    });
    if (!row) return null;
    rows.push(row);
  }
  if (Object.hasOwn(data, "limits") && !Array.isArray(data.limits)) return null;
  for (let index = 0; index < asArray(data.limits).length; index += 1) {
    const item = asRecord(data.limits[index]);
    const detail = asRecord(item?.detail);
    if (!item || !detail) return null;
    const limit = finiteQuotaNumber(detail.limit ?? detail.Limit);
    const remaining = finiteQuotaNumber(detail.remaining ?? detail.Remaining);
    if (limit === null || remaining === null || remaining > limit) return null;
    const windowName = safePlan(item.window?.type ?? item.window?.name, `rate-limit-${index + 1}`);
    const row = boundedQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", windowName),
      limit,
      remaining,
      unit: "requests",
      resetAt: futureResetAt(parseQuotaTimestamp(detail.resetTime ?? detail.reset_at ?? detail.resetAt), now),
      metadata: quotaMetadata({ plan })
    });
    if (!row) return null;
    rows.push(row);
  }
  for (const [key, value] of Object.entries(data)) {
    if (key !== "five_hour" && key !== "seven_day" && !key.startsWith("seven_day_")) continue;
    const window = asRecord(value);
    if (!window) return null;
    // Kimi reports this Claude-shaped fallback as percent remaining.
    const remainingRatio = quotaPercent(window.utilization);
    if (remainingRatio === null) return null;
    const model = key.startsWith("seven_day_") ? key.slice("seven_day_".length) : null;
    const dimension = key === "five_hour" ? "session" : "weekly";
    const row = ratioQuotaRow({
      accountKey,
      resourceKey: model ? quotaScopedKey("model", model) : null,
      dimensionKey: quotaScopedKey("requests", dimension),
      remainingRatio,
      resetAt: futureResetAt(parseQuotaTimestamp(window.resets_at ?? window.resetAt), now),
      metadata: quotaMetadata({ plan, windowSeconds: dimension === "session" ? 5 * 60 * 60 : 7 * 24 * 60 * 60 })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export async function fetchKimiQuota(context) {
  const { config, connection } = context;
  const apiKey = connectionCredential(connection, "apiKey");
  const accessToken = connectionCredential(connection, "accessToken");
  if (!apiKey && !accessToken) return missingCredential(config);
  const headers = apiKey ?
  { "x-api-key": apiKey, Accept: "application/json" } :
  {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "X-Msh-Platform": config.platform,
    "X-Msh-Version": config.version,
    "X-Msh-Device-Model": `${process.platform} ${process.arch}`,
    "X-Msh-Device-Id": stableDeviceId(config.sourceId, connection)
  };
  const result = await createProviderRequest(context)(config.url, { method: "GET", headers });
  if (!result.ok) return providerFailure(config, result);
  const accountRaw = connectionData(connection).accountId ?? connectionData(connection).userId;
  const rows = normalizeKimiQuota(result.data, {
    accountKey: accountRaw ? quotaScopedKey("account", accountRaw, { privateValue: true }) : null,
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}

// ─── GLM Coding Plan ────────────────────────────────────────────────────────

function glmTokenDimension(limit) {
  const unit = finiteQuotaNumber(limit.unit);
  const number = finiteQuotaNumber(limit.number);
  if (unit === 3 && number === 5) return "session";
  if (unit === 6 && number === 1) return "weekly";
  if (unit === 4 && number === 7 || unit === 3 && number >= 24 * 7) return "weekly";
  return null;
}

function glmTeamIdentity(data) {
  const organizationId = data.glmOrganizationId ?? data.bigmodelOrganization ?? data.glmOrganization;
  const projectId = data.glmProjectId ?? data.bigmodelProject ?? data.glmProject;
  const organization = isString(organizationId) && organizationId.trim() ? organizationId.trim() : null;
  const project = isString(projectId) && projectId.trim() ? projectId.trim() : null;
  const malformed = [organization, project].some((value) => value !== null && !/^[A-Za-z0-9._:-]{1,256}$/.test(value));
  return { organization, project, incomplete: Boolean(organization) !== Boolean(project), malformed };
}

export function normalizeGlmQuota(payload, {
  accountKey = null,
  resourceKey = null,
  now = Date.now()
} = {}) {
  const body = asRecord(payload);
  const data = asRecord(body?.data);
  if (!data || !Array.isArray(data.limits) || data.limits.length === 0) return null;
  const plan = safePlan(data.planName ?? data.level)?.replace(/\s*plan$/i, "") || null;
  const rows = [];
  const identities = new Set();
  for (const raw of data.limits) {
    const limit = asRecord(raw);
    if (!limit) return null;
    const type = String(limit.type || "").trim().toUpperCase();
    const resetAt = futureResetAt(parseQuotaTimestamp(limit.nextResetTime ?? limit.next_reset_time), now);
    let row;
    if (type === "TOKENS_LIMIT" || type === "TOKEN_LIMIT") {
      const dimension = glmTokenDimension(limit);
      const usedRatio = quotaPercent(limit.percentage);
      if (!dimension || usedRatio === null) return null;
      row = ratioQuotaRow({
        accountKey,
        resourceKey,
        dimensionKey: quotaScopedKey("tokens", dimension),
        remainingRatio: 1 - usedRatio,
        resetAt,
        metadata: quotaMetadata({
          plan,
          displayName: dimension === "session" ? "5 Hours Quota" : dimension === "weekly" ? "Weekly Quota" : "Tokens"
        })
      });
    } else if (type === "TIME_LIMIT" || type === "TIME_USAGE_LIMIT") {
      const total = finiteQuotaNumber(limit.usage ?? limit.total);
      const used = finiteQuotaNumber(limit.currentValue ?? limit.used);
      const remaining = finiteQuotaNumber(limit.remaining);
      if (total !== null && total > 0 && used !== null && remaining !== null) {
        row = boundedQuotaRow({
          accountKey,
          resourceKey,
          dimensionKey: quotaScopedKey("tools", "monthly"),
          limit: total,
          used,
          remaining,
          unit: "tools",
          resetAt,
          metadata: quotaMetadata({ plan, displayName: "Monthly Tools" })
        });
      } else {
        const usedRatio = quotaPercent(limit.percentage);
        if (usedRatio === null) return null;
        row = ratioQuotaRow({
          accountKey,
          resourceKey,
          dimensionKey: quotaScopedKey("tools", "monthly"),
          remainingRatio: 1 - usedRatio,
          resetAt,
          metadata: quotaMetadata({ plan, displayName: "Monthly Tools" })
        });
      }
    } else {
      return null;
    }
    if (!row || identities.has(row.dimensionKey)) return null;
    identities.add(row.dimensionKey);
    rows.push(row);
  }
  return rows;
}

export async function fetchGlmQuota(context) {
  const { config, connection } = context;
  const apiKey = connectionCredential(connection, "apiKey");
  if (!apiKey) return missingCredential(config);
  const data = connectionData(connection);
  const team = glmTeamIdentity(data);
  if (team.malformed) return providerFailure(config, { outcome: "malformed" });
  if (team.incomplete) return providerFailure(config, { outcome: "missing" });
  const url = team.organization ? `${config.url}?type=2` : config.url;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  if (team.organization) {
    headers["bigmodel-organization"] = team.organization;
    headers["bigmodel-project"] = team.project;
  }
  const result = await createProviderRequest(context)(url, {
    method: "GET",
    headers
  });
  if (!result.ok) return providerFailure(config, result);
  const root = asRecord(result.data);
  if (!root) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  const code = Number(root.code);
  if (root.success === false || [401, 403, 429].includes(code)) {
    const outcome = code === 401 ? "unauthenticated" : code === 403 ? "forbidden" : code === 429 ? "rate_limited" : "provider_error";
    return providerFailure(config, { outcome, attemptedAt: result.attemptedAt });
  }
  const accountRaw = team.organization ?? data.organizationId ?? data.teamId;
  const resourceRaw = team.project ?? data.projectId;
  const rows = normalizeGlmQuota(result.data, {
    accountKey: accountRaw ? quotaScopedKey("account", accountRaw, { privateValue: true }) : null,
    resourceKey: resourceRaw ? quotaScopedKey("project", resourceRaw, { privateValue: true }) : null,
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}

// ─── MiniMax ────────────────────────────────────────────────────────────────

function field(record, snake, camel) {
  return record?.[snake] ?? record?.[camel];
}

function minimaxReset(model, now, relativeSnake, relativeCamel, absoluteSnake, absoluteCamel) {
  const relative = finiteQuotaNumber(field(model, relativeSnake, relativeCamel));
  if (relative !== null && relative > 0) return futureResetAt(new Date(now + relative).toISOString(), now);
  return futureResetAt(parseQuotaTimestamp(field(model, absoluteSnake, absoluteCamel)), now);
}

function minimaxWindow(model, {
  totalSnake,
  totalCamel,
  countSnake,
  countCamel,
  percentSnake,
  percentCamel,
  accountKey,
  resourceKey,
  dimension,
  resetAt,
  displayName
}) {
  const total = finiteQuotaNumber(field(model, totalSnake, totalCamel));
  const count = finiteQuotaNumber(field(model, countSnake, countCamel));
  const remainingRatio = quotaPercent(field(model, percentSnake, percentCamel));
  if ((total === null || total === 0) && remainingRatio === null) return undefined;
  if (total !== null && total > 0) {
    if (count === null || count > total || remainingRatio === null) return null;
    const remainingIfUsed = total - count;
    const usedCountMatches = Math.abs(remainingIfUsed / total - remainingRatio) <= 0.011;
    const remainingCountMatches = Math.abs(count / total - remainingRatio) <= 0.011;
    if (usedCountMatches === remainingCountMatches) return null;
    const remaining = usedCountMatches ? remainingIfUsed : count;
    const used = total - remaining;
    return boundedQuotaRow({
      accountKey,
      resourceKey,
      dimensionKey: quotaScopedKey("requests", dimension),
      limit: total,
      used,
      remaining,
      unit: "requests",
      resetAt,
      metadata: quotaMetadata({ displayName })
    });
  }
  return ratioQuotaRow({
    accountKey,
    resourceKey,
    dimensionKey: quotaScopedKey("requests", dimension),
    remainingRatio,
    resetAt,
    metadata: quotaMetadata({ displayName })
  });
}

export function normalizeMiniMaxQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const body = asRecord(payload);
  const models = body?.model_remains ?? body?.modelRemains;
  if (!Array.isArray(models)) return null;
  const textModels = [];
  for (const raw of models) {
    const model = asRecord(raw);
    if (!model) return null;
    const name = safePlan(field(model, "model_name", "modelName"));
    if (!name) return null;
    const normalized = name.toLowerCase();
    if (normalized.startsWith("minimax-m") || normalized.startsWith("coding-plan") || normalized === "general") {
      textModels.push(model);
    }
  }
  if (textModels.length === 0) return null;
  const pickRepresentative = (totalSnake, totalCamel) => textModels.reduce((best, candidate) => {
    const candidateTotal = finiteQuotaNumber(field(candidate, totalSnake, totalCamel)) || 0;
    const bestTotal = finiteQuotaNumber(field(best, totalSnake, totalCamel)) || 0;
    return candidateTotal > bestTotal ? candidate : best;
  });
  const sessionModel = pickRepresentative("current_interval_total_count", "currentIntervalTotalCount");
  const weeklyModel = pickRepresentative("current_weekly_total_count", "currentWeeklyTotalCount");
  const sessionName = safePlan(field(sessionModel, "model_name", "modelName"));
  const weeklyName = safePlan(field(weeklyModel, "model_name", "modelName"));
  const session = minimaxWindow(sessionModel, {
    totalSnake: "current_interval_total_count", totalCamel: "currentIntervalTotalCount",
    countSnake: "current_interval_usage_count", countCamel: "currentIntervalUsageCount",
    percentSnake: "current_interval_remaining_percent", percentCamel: "currentIntervalRemainingPercent",
    accountKey, resourceKey: null, dimension: "session", displayName: sessionName,
    resetAt: minimaxReset(sessionModel, now, "remains_time", "remainsTime", "end_time", "endTime")
  });
  const weekly = minimaxWindow(weeklyModel, {
    totalSnake: "current_weekly_total_count", totalCamel: "currentWeeklyTotalCount",
    countSnake: "current_weekly_usage_count", countCamel: "currentWeeklyUsageCount",
    percentSnake: "current_weekly_remaining_percent", percentCamel: "currentWeeklyRemainingPercent",
    accountKey, resourceKey: null, dimension: "weekly", displayName: weeklyName,
    resetAt: minimaxReset(weeklyModel, now, "weekly_remains_time", "weeklyRemainsTime", "weekly_end_time", "weeklyEndTime")
  });
  if (session === null || weekly === null) return null;
  const rows = [session, weekly].filter(Boolean);
  return rows.length > 0 ? rows : null;
}

export async function fetchMiniMaxQuota(context) {
  const { config, connection } = context;
  const apiKey = connectionCredential(connection, "apiKey");
  if (!apiKey) return missingCredential(config);
  const request = createProviderRequest(context);
  let lastFailure = null;
  for (const endpoint of config.urls) {
    const result = await request(endpoint.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
    });
    if (!result.ok) {
      lastFailure = result;
      if (["unauthenticated", "forbidden", "rate_limited"].includes(result.outcome)) break;
      continue;
    }
    const base = asRecord(result.data?.base_resp ?? result.data?.baseResp);
    const apiCode = finiteQuotaNumber(base?.status_code ?? base?.statusCode);
    const apiMessage = String(base?.status_msg ?? base?.statusMsg ?? base?.message ?? "").toLowerCase();
    if (
    apiCode === 1004 ||
    /token plan|coding plan|invalid api key|invalid key|unauthorized|inactive/.test(apiMessage))
    return providerFailure(config, { outcome: "unauthenticated", attemptedAt: result.attemptedAt });
    if (apiCode !== null && apiCode !== 0) {
      lastFailure = { outcome: "provider_error", attemptedAt: result.attemptedAt };
      continue;
    }
    const rows = normalizeMiniMaxQuota(result.data, {
      now: new Date(result.attemptedAt).getTime()
    });
    if (rows === null) {
      lastFailure = { outcome: "malformed", attemptedAt: result.attemptedAt };
      continue;
    }
    return providerSuccess(config, rows, result.attemptedAt);
  }
  return providerFailure(config, lastFailure);
}

// ─── CodeBuddy CN ───────────────────────────────────────────────────────────

function codeBuddyNumber(account, precise, plain) {
  return finiteQuotaNumber(account?.[precise] ?? account?.[plain]);
}

function codeBuddyRecurring(account) {
  const cycleEnd = parseQuotaTimestamp(account.CycleEndTime);
  const deductionEnd = parseQuotaTimestamp(account.DeductionEndTime);
  if (!cycleEnd || !deductionEnd) return false;
  return new Date(deductionEnd).getTime() - new Date(cycleEnd).getTime() > 2 * 24 * 60 * 60 * 1000;
}

export function normalizeCodeBuddyQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const root = asRecord(payload);
  if (!root || root.code !== 0) return null;
  const accounts = root.data?.Response?.Data?.Accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const ordered = accounts.map((raw) => {
    const account = asRecord(raw);
    if (!account) return null;
    const recurring = codeBuddyRecurring(account);
    const end = parseQuotaTimestamp(account.CycleEndTime);
    return { account, recurring, endMs: end ? new Date(end).getTime() : Number.POSITIVE_INFINITY };
  });
  if (ordered.some((entry) => !entry)) return null;
  ordered.sort((left, right) => Number(right.recurring) - Number(left.recurring) || left.endMs - right.endMs);
  const rows = [];
  let bonusIndex = 0;
  const cadenceSeen = new Map();
  for (const { account, recurring } of ordered) {
    const used = recurring ?
    codeBuddyNumber(account, "CycleCapacityUsedPrecise", "CycleCapacityUsed") :
    codeBuddyNumber(account, "CapacityUsedPrecise", "CapacityUsed");
    const limit = recurring ?
    codeBuddyNumber(account, "CycleCapacitySizePrecise", "CycleCapacitySize") :
    codeBuddyNumber(account, "CapacitySizePrecise", "CapacitySize");
    if (used === null || limit === null) return null;
    const start = parseQuotaTimestamp(account.CycleStartTime);
    const end = futureResetAt(parseQuotaTimestamp(account.CycleEndTime), now);
    let name;
    if (recurring) {
      const days = start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 : null;
      const cadence = days !== null && days <= 1.5 ? "daily" : days !== null && days <= 10 ? "weekly" : "monthly";
      const count = (cadenceSeen.get(cadence) || 0) + 1;
      cadenceSeen.set(cadence, count);
      name = count === 1 ? cadence : `${cadence}-${count}`;
    } else {
      bonusIndex += 1;
      name = `bonus-${bonusIndex}`;
    }
    const row = boundedQuotaRow({
      accountKey,
      resourceKey: quotaScopedKey("package", name),
      dimensionKey: quotaScopedKey("credits", "capacity"),
      limit,
      used,
      unit: "credits",
      resetAt: end,
      metadata: quotaMetadata({
        displayName: safePlan(account.PackageName ?? account.SubProductName, name),
        recurring
      })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

export async function fetchCodeBuddyQuota(context) {
  const { config, connection } = context;
  const token = connectionCredential(connection, "accessToken", "apiKey");
  if (!token) return missingCredential(config);
  const result = await createProviderRequest(context)(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1"
    },
    body: "{}"
  });
  if (!result.ok) return providerFailure(config, result);
  if (result.data?.code !== 0) return providerFailure(config, { outcome: "provider_error", attemptedAt: result.attemptedAt });
  const data = connectionData(connection);
  const accountRaw = data.accountId ?? data.userId;
  const rows = normalizeCodeBuddyQuota(result.data, {
    accountKey: accountRaw ? quotaScopedKey("account", accountRaw, { privateValue: true }) : null,
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}

// ─── Bailian Coding Plan ────────────────────────────────────────────────────

export function normalizeBailianQuota(payload, { now = Date.now() } = {}) {
  const root = asRecord(payload);
  if (!root || !["Success", "200"].includes(String(root.code))) return null;
  const instances = root.data?.codingPlanInstanceInfos;
  if (!Array.isArray(instances) || instances.length === 0) return null;
  const quota = asRecord(instances[0]?.codingPlanQuotaInfo);
  if (!quota) return null;
  const rows = [];
  for (const [name, usedField, totalField, resetField, seconds] of [
  ["session", "per5HourUsedQuota", "per5HourTotalQuota", "per5HourQuotaNextRefreshTime", 5 * 60 * 60],
  ["weekly", "perWeekUsedQuota", "perWeekTotalQuota", "perWeekQuotaNextRefreshTime", 7 * 24 * 60 * 60],
  ["monthly", "perBillMonthUsedQuota", "perBillMonthTotalQuota", "perBillMonthQuotaNextRefreshTime", null]])
  {
    const used = finiteQuotaNumber(quota[usedField]);
    const limit = finiteQuotaNumber(quota[totalField]);
    if (used === null || limit === null || limit <= 0) return null;
    const row = boundedQuotaRow({
      dimensionKey: quotaScopedKey("requests", name),
      limit,
      used,
      unit: "requests",
      resetAt: futureResetAt(parseQuotaTimestamp(quota[resetField]), now),
      metadata: quotaMetadata({ windowSeconds: seconds })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

const QWEN_TOKEN_PLAN_PRODUCT = "sfm_bailian";
const QWEN_TOKEN_PLAN_ACTION = "IntlBroadScopeAspnGateway";
const QWEN_TOKEN_PLAN_COMMODITY = "sfm_tokenplansolo_public_intl";

function qwenTokenPlanCookie(data) {
  for (const key of ["qwenCloudCookie", "alibabaConsoleCookie", "cookie"]) {
    if (isString(data[key]) && data[key].trim()) return data[key].trim();
  }
  return null;
}

function qwenTokenPlanSite(cookie, config) {
  if (config?.tokenPlanHosts?.international && /login_aliyunid_ticket=/.test(cookie)) {
    return { consoleSite: "ALIYUN", domain: "modelstudio.console.alibabacloud.com", host: config.tokenPlanHosts.international };
  }
  return { consoleSite: "QWENCLOUD", domain: "home.qwencloud.com", host: config.tokenPlanHosts?.domestic };
}

function qwenTokenPlanPayload(endpoint, data, site) {
  const api = `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/${endpoint}`;
  return new URLSearchParams({
    product: QWEN_TOKEN_PLAN_PRODUCT,
    action: QWEN_TOKEN_PLAN_ACTION,
    sec_token: data.qwenCloudSecToken || data.alibabaConsoleSecToken || data.secToken || "",
    region: data.qwenCloudRegion || data.region || "ap-southeast-1",
    params: JSON.stringify({ Api: api, V: "1.0", Data: { commodityCode: QWEN_TOKEN_PLAN_COMMODITY, cornerstoneParam: { console: "ONE_CONSOLE", consoleSite: site.consoleSite, domain: site.domain, productCode: "p_efm", protocol: "V2", xsp_lang: "en-US" } } })
  }).toString();
}

function qwenTokenPlanEnvelope(payload) {
  return asRecord(asRecord(asRecord(payload)?.data)?.DataV2)?.data;
}

function qwenTokenPlanEnvelopeOutcome(payload) {
  const envelope = qwenTokenPlanEnvelope(payload);
  if (!envelope) return "malformed";
  if (envelope.code === "SUCCESS" && envelope.success === true && asRecord(envelope.data)) return null;
  if (["ConsoleNeedLogin", "ConsoleSessionExpired", "LoginRequired"].includes(envelope.code)) return "unauthenticated";
  return isString(envelope.code) && envelope.code ? "provider_error" : "malformed";
}

function unwrapQwenTokenPlanPayload(payload) {
  const data = qwenTokenPlanEnvelope(payload);
  return data?.code === "SUCCESS" && data.success === true ? asRecord(data.data) : null;
}

function qwenTokenPlanLimit(quotaConfig, plan, field) {
  const tier = asRecord(quotaConfig?.[plan]);
  const value = finiteQuotaNumber(tier?.[field]);
  return value && value > 0 ? value : null;
}

export function normalizeQwenTokenPlanQuota(payload, { now = Date.now() } = {}) {
  const root = asRecord(payload);
  const usage = asRecord(root?.usage);
  const subscription = asRecord(root?.subscription);
  const quotaConfig = asRecord(root?.quotaConfig);
  const plan = safePlan(subscription?.specCode);
  if (!usage || !quotaConfig || !plan) return null;
  const rows = [];
  for (const [name, percentageField, resetField, quotaField, seconds] of [
  ["session", "per5HourPercentage", "per5HourResetTime", "five_hour", 5 * 60 * 60],
  ["weekly", "per1WeekPercentage", "per1WeekResetTime", "weekly", 7 * 24 * 60 * 60]])
  {
    if (!Object.hasOwn(usage, percentageField)) continue;
    const usedRatio = finiteQuotaNumber(usage[percentageField], { min: 0, max: 1 });
    const limit = qwenTokenPlanLimit(quotaConfig, plan, quotaField);
    if (usedRatio === null || limit === null) return null;
    const row = boundedQuotaRow({
      dimensionKey: quotaScopedKey("requests", name),
      limit,
      used: limit * usedRatio,
      unit: "requests",
      resetAt: futureResetAt(parseQuotaTimestamp(usage[resetField]), now),
      metadata: quotaMetadata({ plan, windowSeconds: seconds })
    });
    if (!row) return null;
    rows.push(row);
  }
  return rows.length ? rows : null;
}

async function fetchQwenTokenPlanQuota(context, data) {
  const { config } = context;
  const cookie = qwenTokenPlanCookie(data);
  if (!cookie) return null;
  const request = createProviderRequest(context);
  const site = qwenTokenPlanSite(cookie, config);
  const url = `${site.host}/data/api.json?product=${QWEN_TOKEN_PLAN_PRODUCT}&action=${QWEN_TOKEN_PLAN_ACTION}&api=zeldaHttp.apikeyMgr.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage`;
  const headers = { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Origin: `https://${site.domain}`, Referer: `https://${site.domain}/` };
  const results = [];
  let attemptedAt = null;
  for (const endpoint of ["usage", "quota-config", "subscription"]) {
    const result = await request(endpoint === "usage" ? url : url.replace(/usage$/, endpoint), {
      method: "POST", headers, body: qwenTokenPlanPayload(endpoint, data, site)
    });
    attemptedAt = result.attemptedAt;
    if (!result.ok) return { failure: result };
    const payload = unwrapQwenTokenPlanPayload(result.data);
    if (!payload) return { failure: { outcome: qwenTokenPlanEnvelopeOutcome(result.data), attemptedAt, retryAt: null } };
    results.push(payload);
  }
  const rows = normalizeQwenTokenPlanQuota({ usage: results[0], quotaConfig: results[1], subscription: results[2] }, { now: new Date(attemptedAt).getTime() });
  if (rows === null) return { failure: { outcome: "malformed", attemptedAt } };
  return { rows, attemptedAt };
}

export async function fetchBailianQuota(context) {
  const { config, connection } = context;
  const data = connectionData(connection);
  const personal = await fetchQwenTokenPlanQuota(context, data);
  if (personal?.rows) {
    return { outcome: "success", sourceId: config.tokenPlanSourceId, rows: personal.rows, attemptedAt: personal.attemptedAt };
  }
  const key = isString(data.consoleApiKey) && data.consoleApiKey.trim() ?
  data.consoleApiKey.trim() :
  connectionCredential(connection, "apiKey");
  if (!key) return personal?.failure ? { ...personal.failure, sourceId: config.tokenPlanSourceId } : missingCredential(config);
  const request = createProviderRequest(context);
  const headers = {
    Authorization: `Bearer ${key}`,
    "x-api-key": key,
    "X-DashScope-API-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  let lastFailure = null;
  for (let index = 0; index < config.urls.length; index += 1) {
    const result = await request(config.urls[index], { method: "POST", headers, body: "{}" });
    if (!result.ok) {
      lastFailure = result;
      if (["unauthenticated", "forbidden", "rate_limited"].includes(result.outcome)) break;
      continue;
    }
    if (result.data?.code === "ConsoleNeedLogin" && index + 1 < config.urls.length) {
      lastFailure = { outcome: "forbidden", attemptedAt: result.attemptedAt };
      continue;
    }
    const rows = normalizeBailianQuota(result.data, { now: new Date(result.attemptedAt).getTime() });
    if (rows === null) {
      lastFailure = { outcome: "malformed", attemptedAt: result.attemptedAt };
      continue;
    }
    return providerSuccess(config, rows, result.attemptedAt);
  }
  return providerFailure(config, lastFailure || personal?.failure);
}

// ─── Qoder ──────────────────────────────────────────────────────────────────

function qoderLegacyRow(raw, { accountKey, resource, resetAt, exhausted }) {
  const quota = asRecord(raw);
  if (!quota) return null;
  const limit = finiteQuotaNumber(quota.total);
  const used = finiteQuotaNumber(quota.used);
  const remaining = finiteQuotaNumber(quota.remaining);
  if (Object.hasOwn(quota, "total") && limit === null) return null;
  if (Object.hasOwn(quota, "used") && used === null) return null;
  if (Object.hasOwn(quota, "remaining") && remaining === null) return null;
  const unit = quota.unit === undefined || quota.unit === null ?
  "credits" :
  isString(quota.unit) && ["credits", "requests", "tokens"].includes(quota.unit.trim().toLowerCase()) ?
  quota.unit.trim().toLowerCase() :
  null;
  if (!unit) return null;
  if (limit !== null && limit > 0) {
    if (used === null || remaining === null || Math.abs(Math.max(limit - used, 0) - remaining) > Math.max(1e-9, limit * 1e-9)) return null;
    return boundedQuotaRow({
      accountKey,
      resourceKey: quotaScopedKey("scope", resource),
      dimensionKey: quotaScopedKey("credits", "plan"),
      limit,
      used,
      remaining,
      unit,
      resetAt,
      exhausted
    });
  }
  if (remaining !== null) {
    return remainingQuotaRow({
      accountKey,
      resourceKey: quotaScopedKey("scope", resource),
      dimensionKey: quotaScopedKey("credits", "plan"),
      used,
      remaining,
      unit,
      resetAt,
      exhausted
    });
  }
  return quotaRow({
    accountKey,
    resourceKey: quotaScopedKey("scope", resource),
    dimensionKey: quotaScopedKey("credits", "plan"),
    unit,
    resetAt,
    exhausted
  });
}

function normalizeQoderLegacyQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const data = asRecord(payload);
  if (!data) return null;
  const resetAt = futureResetAt(parseQuotaTimestamp(data.expiresAt ?? data.nextResetAt), now);
  const exhausted = data.isQuotaExceeded === true;
  const rows = [];
  for (const [field, resource] of [["userQuota", "user"], ["orgResourcePackage", "organization"]]) {
    if (data[field] === null || data[field] === undefined) continue;
    const row = qoderLegacyRow(data[field], { accountKey, resource, resetAt, exhausted });
    if (!row) return null;
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export function normalizeQoderStatusQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const root = asRecord(payload);
  const status = asRecord(root?.data) || root;
  if (!status || !isBoolean(status.isQuotaExceeded)) return null;
  const userType = isString(status.userType) ? status.userType.trim().toLowerCase() : "";
  const quota = finiteQuotaNumber(status.quota);
  if (!userType || quota === null) return null;
  const planRaw = safePlan(status.userTag ?? status.plan, "Qoder");
  const plan = planRaw.replace(/^PLAN_TIER_/i, "").replace(/_/g, " ").toLowerCase();
  const resetAt = futureResetAt(parseQuotaTimestamp(status.nextResetAt), now);
  const pooled = userType === "teams" || userType === "enterprise";
  let row;
  if (status.isQuotaExceeded) {
    row = boundedQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", "plan"),
      limit: quota,
      used: quota,
      remaining: 0,
      unit: "requests",
      resetAt,
      exhausted: true,
      metadata: quotaMetadata({ plan, displayName: "Quota exceeded" })
    });
  } else if (pooled) {
    row = quotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", "plan"),
      limitKind: "unlimited",
      used: 0,
      unit: "requests",
      resetAt,
      metadata: quotaMetadata({ plan, displayName: `${plan} pooled quota` })
    });
  } else {
    row = remainingQuotaRow({
      accountKey,
      dimensionKey: quotaScopedKey("requests", "plan"),
      remaining: quota,
      unit: "requests",
      resetAt,
      metadata: quotaMetadata({ plan, displayName: `${quota} requests left` })
    });
  }
  return row ? [row] : null;
}

export function normalizeQoderQuota(payload, options = {}) {
  const root = asRecord(payload);
  if (root && !Object.hasOwn(root, "userQuota") && !Object.hasOwn(root, "orgResourcePackage") && (
  Object.hasOwn(root, "userType") || asRecord(root.data)?.userType)) {
    return normalizeQoderStatusQuota(payload, options);
  }
  return normalizeQoderLegacyQuota(payload, options);
}

export async function fetchQoderQuota(context) {
  const { config, connection } = context;
  const request = createProviderRequest(context);
  if (config.mode === "pat-status") {
    const pat = connectionCredential(connection, "apiKey", "qoderPat");
    if (!pat || !pat.startsWith("pt-") && !pat.startsWith("jt-")) return missingCredential(config);
    let token = pat;
    if (pat.startsWith("pt-")) {
      const exchange = await request(config.exchangeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ personal_token: pat })
      });
      if (!exchange.ok) return providerFailure(config, exchange);
      const exchangeRoot = asRecord(exchange.data);
      const exchangeData = asRecord(exchangeRoot?.data);
      const candidates = [exchangeRoot?.job_token, exchangeRoot?.jobToken, exchangeRoot?.jt, exchangeRoot?.token, exchangeData?.job_token, exchangeData?.jobToken, exchangeData?.jt, exchangeData?.token];
      token = candidates.find((value) => isString(value) && value.startsWith("jt-"));
      if (!token) return providerFailure(config, { outcome: "malformed", attemptedAt: exchange.attemptedAt });
    }
    const result = await request(config.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (!result.ok) return providerFailure(config, result);
    const data = connectionData(connection);
    const accountRaw = result.data?.userId ?? data.userId ?? data.accountId;
    const rows = normalizeQoderStatusQuota(result.data, {
      accountKey: accountRaw ? quotaScopedKey("account", accountRaw, { privateValue: true }) : null,
      now: new Date(result.attemptedAt).getTime()
    });
    if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
    return providerSuccess(config, rows, result.attemptedAt);
  }

  const token = connectionCredential(connection, "accessToken", "token");
  if (!token) return missingCredential(config);
  const result = await request(config.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!result.ok) return providerFailure(config, result);
  const data = connectionData(connection);
  const accountRaw = data.userId ?? data.accountId ?? data.deviceId;
  const rows = normalizeQoderQuota(result.data, {
    accountKey: accountRaw ? quotaScopedKey("account", accountRaw, { privateValue: true }) : null,
    now: new Date(result.attemptedAt).getTime()
  });
  if (rows === null) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}