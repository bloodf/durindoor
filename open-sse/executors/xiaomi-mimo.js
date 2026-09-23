import { DefaultExecutor } from "./default.js";
import { getMimoAccountCookie, invalidateMimoAccountCookieCache, resolveMimoServerBase, MIMO_API_UA } from "../shared/mimoAccount.js";

/**
 * Xiaomi MiMo executor (dual auth).
 *
 * - API key (sk-) connections keep the cloud API on api.xiaomimimo.com through
 *   the registry transports, unchanged.
 * - Connections that carry a Xiaomi account session (`providerSpecificData.mimoPassToken`,
 *   captured by the dashboard login or imported from MiMo Desktop) send the
 *   v2.6 models to the account-service route on the connection's cluster
 *   (`mimo-server-<region>.xiaomimimo.com/api/route/chat/completions`), which
 *   bills the account's weekly Desktop quota instead of the key.
 *
 * The account route is used only after a session cookie is resolved; when the
 * handshake fails the request falls back to the cloud API.
 */
const ACCOUNT_MODELS = new Set([
  "mimo-v2.6-pro",
  "mimo-v2.6-flash",
  "mimo-v2.6-pro-ultraspeed",
]);

// Session cookie resolved in execute() (async) and read back by buildUrl/
// buildHeaders/transformRequest (sync). Lives on a per-request copy of the
// credentials, never on the stored connection.
const COOKIE_KEY = "__mimoAccountCookie";

// Upstream calls may hand us either the bare id or a `provider/model` ref.
function bareModel(model) {
  const s = String(model || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

export class XiaomiMimoExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-mimo");
  }

  /** True when the model/connection pair should try the account-service route. */
  static wantsAccountRoute(model, credentials) {
    return ACCOUNT_MODELS.has(bareModel(model)) && Boolean(credentials?.providerSpecificData?.mimoPassToken);
  }

  /** True once execute() resolved a session cookie for this request. */
  static isAccountRoute(model, credentials) {
    return ACCOUNT_MODELS.has(bareModel(model)) && Boolean(credentials?.[COOKIE_KEY]);
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // The account route is not a declared transport, so resolve it before the
    // default runtimeTransport path. Cloud models keep default handling, so a
    // Claude-format client still reaches /anthropic/v1/messages.
    if (XiaomiMimoExecutor.isAccountRoute(model, credentials)) {
      return `${resolveMimoServerBase(credentials?.providerSpecificData)}/api/route/chat/completions`;
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  buildHeaders(credentials = {}, stream = true, requestContext = null, model = "") {
    if (XiaomiMimoExecutor.isAccountRoute(model, credentials)) {
      // The account route authenticates with the session cookie, not the key.
      return {
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        "User-Agent": MIMO_API_UA,
        Cookie: credentials[COOKIE_KEY],
      };
    }
    return super.buildHeaders(credentials, stream, requestContext, model);
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    const out = super.transformRequest(model, body, stream, credentials, requestContext);
    if (!out || !XiaomiMimoExecutor.isAccountRoute(model, credentials)) return out;

    // The account service names models `xiaomi/<id>`; the cloud API does not.
    const result = { ...out, model: `xiaomi/${bareModel(model)}` };

    // Bridge reasoning_effort to output_config.effort, as MiMo Desktop does.
    // The account route has no xhigh tier; it maps to high.
    const rawEffort = out.reasoning_effort || body?.reasoning_effort || body?.output_config?.effort;
    if (rawEffort) {
      delete result.reasoning_effort;
      const effort = String(rawEffort).toLowerCase();
      result.output_config = { ...(out.output_config || {}), effort: effort === "xhigh" ? "high" : effort };
    }
    // Desktop defaults; never override what the caller set.
    if (result.temperature == null) result.temperature = 1.0;
    if (result.top_p == null) result.top_p = 0.95;
    return result;
  }

  async execute(args) {
    const { model, credentials, proxyOptions = null } = args;
    if (!XiaomiMimoExecutor.wantsAccountRoute(model, credentials)) return super.execute(args);

    const cookie = await getMimoAccountCookie(credentials.providerSpecificData, proxyOptions);
    // No session (handshake failed, token revoked): serve the model from the cloud API.
    if (!cookie) return super.execute(args);

    const result = await super.execute({ ...args, credentials: { ...credentials, [COOKIE_KEY]: cookie } });

    // A cached session can expire early — drop it and retry once with a fresh one.
    if (result?.response?.status === 401) {
      invalidateMimoAccountCookieCache();
      const fresh = await getMimoAccountCookie(credentials.providerSpecificData, proxyOptions).catch(() => null);
      if (fresh) {
        result.response.body?.cancel?.().catch?.(() => {});
        return super.execute({ ...args, credentials: { ...credentials, [COOKIE_KEY]: fresh } });
      }
    }
    return result;
  }
}

export const __test__ = { ACCOUNT_MODELS, bareModel, COOKIE_KEY };

export default XiaomiMimoExecutor;
