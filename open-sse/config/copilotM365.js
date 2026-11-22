/**
 * Microsoft 365 Copilot native sign-in constants.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `src/lib/oauth/providers/copilot-m365-web.ts`
 * and `open-sse/executors/copilot-m365-connection.ts` at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * The client id is the public SPA client id that m365.cloud.microsoft itself uses; it is an
 * identifier, not a secret, and no client secret exists for this flow. `M365_OAUTH_CLIENT_ID`
 * overrides it for self-hosted tenants that register their own public client.
 */

import { isString } from "../../src/shared/utils/typeChecks.js";

const DEFAULT_CLIENT_ID = "c0ab8ce9-e9a0-42e7-b064-33d422df41f1";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const M365_PROVIDER_ID = "copilot-m365-web";

/** Microsoft's login host. Every credentialed token request stays on this origin. */
export const M365_LOGIN_ORIGIN = "https://login.microsoftonline.com";

/** The fixed native-client redirect. Microsoft never serves a page there; the user copies the URL. */
export const M365_NATIVE_REDIRECT_URI = `${M365_LOGIN_ORIGIN}/common/oauth2/nativeclient`;

export const M365_OAUTH_SCOPE =
  "openid profile offline_access https://substrate.office.com/sydney/M365Chat.Read " +
  "https://substrate.office.com/sydney/sydney.readwrite";

/** Consumer (MSA) tenant id: a work or school account is required for the BizChat surface. */
export const M365_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

export function isM365Guid(value) {
  return isString(value) && GUID_RE.test(value);
}

export function getM365ClientId(env = process.env) {
  const override = String(env?.M365_OAUTH_CLIENT_ID || "").trim();
  return isM365Guid(override) ? override : DEFAULT_CLIENT_ID;
}

export const M365_OAUTH_CONFIG = Object.freeze({
  get clientId() {
    return getM365ClientId();
  },
  authorizeUrl: `${M365_LOGIN_ORIGIN}/common/oauth2/v2.0/authorize`,
  tokenUrl: `${M365_LOGIN_ORIGIN}/common/oauth2/v2.0/token`,
  redirectUri: M365_NATIVE_REDIRECT_URI,
  scope: M365_OAUTH_SCOPE,
  codeChallengeMethod: "S256"
});

/** Token endpoint of one tenant (or `common`); anything else is refused. */
export function m365TokenUrl(tenant = "common") {
  if (tenant !== "common" && !isM365Guid(tenant)) throw new Error("invalid_tenant");
  return `${M365_LOGIN_ORIGIN}/${tenant}/oauth2/v2.0/token`;
}

/**
 * The service behind generated-image artifacts. The chat token is refused there; the same
 * first-party client is preauthorized for it, so a stored refresh token can mint one.
 * Ported from OmniRoute `copilot-m365-connection.ts` (MIT) at 5ffa68e83544.
 */
export const M365_IMAGE_ARTIFACT_SCOPE =
  "openid profile offline_access https://designerappservice.officeapps.live.com/.default";
