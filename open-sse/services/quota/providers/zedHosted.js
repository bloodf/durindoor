/**
 * Zed Hosted Models USD credit balance (optional).
 *
 * Port of OmniRoute `open-sse/services/usage/zedHosted.ts` (MIT). The balance
 * comes from the Orb customer-portal link stored in
 * `providerSpecificData.billingPortalUrl` (or a bare portal token). Every URL is
 * rebuilt from the fixed portal origin plus a validated token/id; redirects are
 * rejected so the token never leaves that origin. The row is display telemetry
 * (`exhausted: false`) and has no preflight policy, so a zero balance never
 * parks or cools down the connection.
 */
import {
  asArray,
  asRecord,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaRow,
  quotaScopedKey } from
"../normalize.js";
import {
  connectionData,
  createProviderRequest,
  futureResetAt,
  missingCredential,
  providerFailure,
  providerSuccess } from
"../providerHelpers.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";

const PORTAL_ORIGIN = "https://portal.withorb.com";
const CUSTOMER_FROM_LINK_URL = `${PORTAL_ORIGIN}/api/v1/customer_from_link`;
const TOKEN_PATTERN = /^[\x21-\x7e]{8,512}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CREDITS = 1e9;
const PORTAL_HEADERS = Object.freeze({
  "User-Agent":
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: PORTAL_ORIGIN,
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "X-Requested-With": "XMLHttpRequest"
});

/**
 * Extract the Orb portal token from a pasted link or bare token.
 * Only the token survives; the Referer is rebuilt from the constant portal origin.
 */
export function extractZedHostedPortalToken(raw) {
  if (!isString(raw) || raw.length > 4096) return null;
  const value = raw.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "portal.withorb.com" || url.username || url.password) {
        return null;
      }
      const token = url.searchParams.get("token");
      return token && TOKEN_PATTERN.test(token) ? token : null;
    } catch {
      return null;
    }
  }
  return TOKEN_PATTERN.test(value) ? value : null;
}

function roundCredits(value) {
  return Math.round(value * 100) / 100;
}

function finiteCredits(value) {
  return finiteQuotaNumber(value, { max: MAX_CREDITS });
}

function validId(value) {
  return isString(value) && ID_PATTERN.test(value) ? value : null;
}

export function normalizeZedHostedQuota(payload, { accountKey = null, now = Date.now() } = {}) {
  const ledger = asRecord(payload);
  if (!ledger) return null;
  const current = asArray(ledger.credit_blocks).
  map(asRecord).
  find((block) => block && finiteCredits(block.balance) !== null);
  if (!current) return null;

  const rawTotal = finiteCredits(current.maximum_initial_balance);
  const limit = rawTotal !== null && rawTotal > 0 ? roundCredits(rawTotal) : null;
  const balance = finiteCredits(ledger.credits_balance) ?? finiteCredits(current.balance);
  if (balance === null) return null;
  const remaining = roundCredits(Math.max(0, balance));
  // Account-level remaining can exceed the current block total; show a bare
  // figure instead of a bounded fraction when that happens.
  const bounded = limit !== null && remaining <= limit;
  const row = quotaRow({
    accountKey,
    dimensionKey: quotaScopedKey("balance", "usd"),
    limitKind: bounded ? "bounded" : "unknown",
    limit: bounded ? limit : null,
    remaining,
    unit: "usd",
    resetAt: futureResetAt(parseQuotaTimestamp(current.expiry_date), now),
    // Display telemetry only: never an admission or cooldown signal.
    exhausted: false,
    metadata: quotaMetadata({ plan: "Zed Hosted", recurring: false })
  });
  return row ? [row] : null;
}

async function fetchPortalJson(request, url, token) {
  return request(url, {
    method: "GET",
    headers: {
      ...PORTAL_HEADERS,
      Referer: `${PORTAL_ORIGIN}/view?token=${encodeURIComponent(token)}`
    }
  });
}

export async function fetchZedHostedQuota(context) {
  const { config, connection } = context;
  const raw = connectionData(connection).billingPortalUrl;
  if (!raw) return missingCredential(config);
  const token = extractZedHostedPortalToken(raw);
  if (!token) return providerFailure(config, { outcome: "missing" });

  const request = createProviderRequest(context);
  const customerResult = await fetchPortalJson(
    request,
    `${CUSTOMER_FROM_LINK_URL}?token=${encodeURIComponent(token)}`,
    token
  );
  if (!customerResult.ok) return providerFailure(config, customerResult);

  const customerBody = asRecord(customerResult.data);
  const customer = asRecord(customerBody?.customer);
  const customerId = validId(customer?.id);
  const pricingUnitId = validId(asRecord(customer?.pricing_unit)?.id);
  if (!customerId || !pricingUnitId) {
    return providerFailure(config, { outcome: "malformed", attemptedAt: customerResult.attemptedAt });
  }

  const ledgerUrl =
  `${PORTAL_ORIGIN}/api/v1/customers/${encodeURIComponent(customerId)}` +
  `/ledger_summary?pricing_unit_id=${encodeURIComponent(pricingUnitId)}` +
  `&token=${encodeURIComponent(token)}`;
  const ledgerResult = await fetchPortalJson(request, ledgerUrl, token);
  if (!ledgerResult.ok) return providerFailure(config, ledgerResult);

  const accountKey = connection.id ? quotaScopedKey("account", connection.id, { privateValue: true }) : null;
  const rows = normalizeZedHostedQuota(ledgerResult.data, {
    accountKey,
    now: new Date(ledgerResult.attemptedAt).getTime()
  });
  if (!rows) return providerFailure(config, { outcome: "malformed", attemptedAt: ledgerResult.attemptedAt });
  return providerSuccess(config, rows, ledgerResult.attemptedAt);
}
