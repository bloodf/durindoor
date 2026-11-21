/**
 * Providers this extension may read cookies for. The table is compiled in on
 * purpose: a pairing can only narrow it, never add a site or a cookie name.
 * It mirrors the dashboard contract (`getCookieImportContract`, derived from the
 * registry `webLogin` block); a unit test fails when the two drift apart.
 */

import { isObjectLike } from "./types.js";

const deepFreeze = (value) => {
  for (const child of Object.values(value)) if (isObjectLike(child)) deepFreeze(child);
  return Object.freeze(value);
};

export const PROVIDERS = deepFreeze({
  "chatgpt-web": {
    label: "ChatGPT Web",
    origin: "https://chatgpt.com",
    cookieNames: ["__Secure-next-auth.session-token"],
    cookiePrefixes: ["__Secure-next-auth.session-token."],
  },
  "grok-web": {
    label: "Grok Web",
    origin: "https://grok.com",
    cookieNames: ["sso"],
    cookiePrefixes: [],
  },
  "muse-spark-web": {
    label: "Muse Spark Web",
    origin: "https://www.meta.ai",
    cookieNames: ["ecto_1_sess"],
    cookiePrefixes: [],
  },
  "perplexity-web": {
    label: "Perplexity Web",
    origin: "https://www.perplexity.ai",
    cookieNames: ["__Secure-next-auth.session-token"],
    cookiePrefixes: ["__Secure-next-auth.session-token."],
  },
});

export const PAIRING_HEADER = "x-durindoor-pairing-token";
export const IMPORT_PATH = "/api/providers/cookie-import";
export const PAIRING_TOKEN_RE = /^ddpair_[A-Za-z0-9_-]{43}$/;
/** Same ceiling the dashboard enforces per import. */
export const MAX_COOKIES = 16;
