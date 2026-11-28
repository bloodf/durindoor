// Adapted from decolua/9router open-sse/services/usage/tokenrouter.js (MIT),
// frozen source c088ba7e1175b425f30e14227781aa80c750d719. Public activation is separate.
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { isBoolean, isNumber, isString } from "../../../src/shared/utils/typeChecks.js";

const BASE = "https://api.tokenrouter.com/api/management";
const unavailable = (message) => ({ plan: "TokenRouter", quotas: {}, message });
const number = (value) => isNumber(value) && Number.isFinite(value);

/**
 * Read the first page of TokenRouter key quotas and the optional USD wallet.
 * The separately stored managementApiKey is the only credential used. Fixed
 * endpoints reject redirects; relays are refused because they receive headers.
 * Missing, malformed, and failed reads never imply an empty balance or quota.
 * @param {object} connection Decrypted connection with managementApiKey.
 * @param {object|null} proxyOptions Selected connection proxy configuration.
 * @returns {Promise<object>} Quota rows or an unavailable message.
 */
export async function getTokenRouterUsage(connection, proxyOptions = null) {
  const key = isString(connection?.managementApiKey) ? connection.managementApiKey.trim() : "";
  if (!key || /[\r\n]/.test(key)) return unavailable("TokenRouter Management Key is unavailable.");
  if (proxyOptions?.vercelRelayUrl) return unavailable("TokenRouter usage is unavailable through a relay.");
  const selectedProxy = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  const proxy = selectedProxy ? { ...proxyOptions, strictProxy: true } : proxyOptions;
  const options = { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10000) };
  let wallet;
  let walletUnavailable = false;
  try {
    const response = await proxyAwareFetch(`${BASE}/self/wallet`, options, proxy);
    if (!response.ok || response.redirected) walletUnavailable = true;
    else {
      const data = (await response.json())?.data;
      if (!number(data?.topUpBalance) || !number(data?.voucherEfficientAmount)) walletUnavailable = true;
      else wallet = data.topUpBalance + data.voucherEfficientAmount;
      if (!number(wallet)) walletUnavailable = true;
    }
  } catch { walletUnavailable = true; }
  try {
    const response = await proxyAwareFetch(`${BASE}/api-keys?page=1&page_size=100`, { ...options, signal: AbortSignal.timeout(10000) }, proxy);
    if (response.status === 401 || response.status === 403) return unavailable("TokenRouter Management Key is invalid or lacks access.");
    if (!response.ok || response.redirected) return unavailable("TokenRouter key quotas are unavailable.");
    const data = (await response.json())?.data;
    if (!Array.isArray(data?.items)) return unavailable("TokenRouter key quota response is unavailable.");
    const quotas = {};
    for (const item of data.items) {
      if (!item || !isString(item.name) || !item.name || !isBoolean(item.unlimited_quota) ||
          !number(item.used_quota) || (!item.unlimited_quota && !number(item.remain_quota)) ||
          !number(item.status) || !number(item.expired_time)) return unavailable("TokenRouter key quota response is unavailable.");
      const neverExpires = item.expired_time === -1;
      const date = neverExpires ? null : new Date(item.expired_time * 1000);
      if (date && (item.expired_time <= 0 || !Number.isFinite(date.getTime()))) return unavailable("TokenRouter key quota response is unavailable.");
      const label = `Key: ${item.name}`;
      if (Object.hasOwn(quotas, label)) return unavailable("TokenRouter key quota response has duplicate names.");
      const row = {
        used: item.used_quota, unlimited: item.unlimited_quota, neverExpires,
        status: item.status === 1 ? "enabled" : "disabled", expiresAt: date?.toISOString() ?? null,
      };
      if (!item.unlimited_quota) {
        row.total = item.used_quota + item.remain_quota;
        row.remaining = item.remain_quota;
        if (!number(row.total)) return unavailable("TokenRouter key quota response is unavailable.");
      }
      quotas[label] = row;
    }
    if (!walletUnavailable) quotas["Account Balance"] = { used: 0, total: wallet, remaining: wallet, isCreditBalance: true, currency: "USD", unit: "USD", unlimited: false };
    const notices = [];
    if (walletUnavailable) notices.push("Wallet balance is unavailable.");
    if (data.items.length === 100 || (number(data.total) && data.total > data.items.length)) notices.push("Only the first 100 API keys are included.");
    if (!Object.keys(quotas).length) notices.push("No API keys were reported.");
    const result = { plan: "TokenRouter", quotas };
    if (notices.length) result.message = notices.join(" ");
    return result;
  } catch {
    return unavailable("TokenRouter key quotas are unavailable.");
  }
}
