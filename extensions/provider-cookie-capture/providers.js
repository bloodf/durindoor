/**
 * Providers this extension may read cookies for. The table is compiled in on
 * purpose: a pairing can only narrow it, never add a site or a cookie name.
 * It mirrors the capture-enabled subset of the dashboard contract.
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
  "chatgpt-web-codex": {
    label: "ChatGPT Web Codex",
    origin: "https://chatgpt.com",
    cookieNames: ["__Secure-next-auth.session-token"],
    cookiePrefixes: ["__Secure-next-auth.session-token."],
  },
  "chatplayground": {
    label: "ChatPlayground",
    origin: "https://app.chatplayground.ai",
    cookieNames: ["__client", "__session"],
    cookiePrefixes: [],
  },
  "claude-web": {
    label: "Claude Web",
    origin: "https://claude.ai",
    cookieNames: ["sessionKey"],
    cookiePrefixes: [],
  },
  "doubao-web": {
    label: "Doubao Web",
    origin: "https://www.dola.com",
    cookieNames: ["sessionid", "s_v_web_id"],
    cookiePrefixes: [],
  },
  "gemini-web": {
    label: "Gemini Web",
    origin: "https://gemini.google.com",
    cookieNames: ["__Secure-1PSID", "__Secure-1PSIDTS"],
    cookiePrefixes: [],
  },
  "grok-web": {
    label: "Grok Web",
    origin: "https://grok.com",
    cookieNames: ["sso"],
    cookiePrefixes: [],
  },
  "lmarena": {
    label: "Arena",
    origin: "https://arena.ai",
    cookieNames: ["arena-auth-prod-v1"],
    cookiePrefixes: ["arena-auth-prod-v1."],
  },
  "maxai": {
    label: "MaxAI",
    origin: "https://www.maxai.co",
    cookieNames: ["access_token", "device_id", "user_id"],
    cookiePrefixes: [],
  },
  "muse-spark-web": {
    label: "Muse Spark Web",
    origin: "https://www.meta.ai",
    cookieNames: ["ecto_1_sess"],
    cookiePrefixes: [],
  },
  "zai-web": {
    label: "Z.ai Web",
    origin: "https://chat.z.ai",
    cookieNames: ["token"],
    cookiePrefixes: [],
  },
  "yuanbao-web": {
    label: "Tencent Yuanbao Web",
    origin: "https://yuanbao.tencent.com",
    cookieNames: ["hy_user", "hy_token"],
    cookiePrefixes: [],
  },
  "perplexity-web": {
    label: "Perplexity Web",
    origin: "https://www.perplexity.ai",
    cookieNames: ["__Secure-next-auth.session-token"],
    cookiePrefixes: ["__Secure-next-auth.session-token."],
  },
  "promptql": {
    label: "PromptQL",
    origin: "https://prompt.ql.app",
    cookieNames: ["__Host-next-auth.csrf-token", "next-auth.session-token"],
    cookiePrefixes: [],
  },
  "notion-web": {
    label: "Notion AI Web",
    origin: "https://app.notion.com",
    cookieNames: ["token_v2"],
    cookiePrefixes: [],
  },
  "notrack-web": {
    label: "NoTrack Web",
    origin: "https://notrack.ai",
    cookieNames: ["uid", "si_usr_id", "si_ses_id"],
    cookiePrefixes: [],
    // Included when the browser has it; a capture without it still succeeds.
    optionalCookies: ["nt_session"],
  },
  "tencent-aistudio-web": {
    label: "Tencent AI Studio Web",
    origin: "https://aistudio.tencent.ai",
    cookieNames: ["sessionid"],
    cookiePrefixes: [],
  },
  "blackbox-web": {
    label: "Blackbox Web",
    origin: "https://app.blackbox.ai",
    cookieNames: ["next-auth.session-token"],
    cookiePrefixes: [],
  },
  "conol-web": {
    label: "Conol Web",
    origin: "https://conol.ai",
    cookieNames: ["__Secure-better-auth.session_token"],
    cookiePrefixes: [],
  },
  // TinyCMS has no session cookie: the device UUID is a localStorage item of the site.
  "tinycms-web": {
    label: "TinyCMS Web",
    origin: "https://site.tinycms.xyz",
    cookieNames: [],
    cookiePrefixes: [],
    localStorageKeys: ["app-config-uuid"],
  },
});

export const PAIRING_HEADER = "x-durindoor-pairing-token";
export const IMPORT_PATH = "/api/providers/cookie-import";
export const PAIRING_TOKEN_RE = /^ddpair_[A-Za-z0-9_-]{43}$/;
/** Same ceiling the dashboard enforces per import. */
export const MAX_COOKIES = 16;
