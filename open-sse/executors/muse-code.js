import { DefaultExecutor } from "./default.js";
import {
  MUSE_CODE_ATTESTATION_DENIED_MESSAGE,
  MUSE_CODE_CLIENT_IDENTITY_HEADERS,
  isMuseAttestationDenied,
  isMuseDcaToken
} from "../config/museCode.js";
import { refreshMuseCodeToken } from "../services/museCodeAuth.js";

/**
 * Muse Code (Meta) executor. Requests use the OpenAI Responses wire through
 * DefaultExecutor; this class owns the credential lifecycle and keeps the two
 * Meta credentials apart.
 *
 * A connection carries exactly one of two credentials:
 *
 * - A Meta Model API key, pasted or imported. Meta documents that key for
 *   external clients on `https://api.meta.ai/v1` with a bearer token, and the
 *   documented request carries no Muse Code client fingerprint, so it travels
 *   bare. It is never reminted: a Model API key has no device token behind
 *   it.
 * - A Muse Code subscription key, minted from the device token of the Muse
 *   Code sign-in. Meta scopes that credential to the Muse Code client, so it
 *   keeps the Muse Code client identity.
 *
 * A device login stores the durable `dca:` token and a minted inference key.
 * When the key is missing (the stored access token is still the `dca:` token)
 * or the API rejects it, the key is reminted from the `dca:` token.
 */
export class MuseCodeExecutor extends DefaultExecutor {
  constructor() {
    super("muse-code");
  }

  /**
   * True when the connection authenticates with a Meta Model API key.
   *
   * `applyAuth` sends `apiKey` before `accessToken`, so the presence of an
   * API key is exactly what decides which credential goes on the wire.
   */
  isModelApiKeyConnection(credentials) {
    return !!credentials?.apiKey;
  }

  buildHeaders(credentials = {}, stream = true, requestContext = null, model = "") {
    const headers = super.buildHeaders(credentials, stream, requestContext, model);
    if (this.isModelApiKeyConnection(credentials)) {
      // The Model API key is documented for external clients: no Muse Code
      // client fingerprint goes on the wire. The subscription path keeps its
      // identity, because that credential is scoped to the Muse Code client.
      for (const name of MUSE_CODE_CLIENT_IDENTITY_HEADERS) delete headers[name];
    }
    return headers;
  }

  needsRefresh(credentials) {
    if (!credentials?.apiKey && isMuseDcaToken(credentials?.accessToken)) return true;
    return super.needsRefresh(credentials);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshMuseCodeToken(credentials?.refreshToken, credentials?.providerSpecificData, log, proxyOptions);
  }

  parseError(response, bodyText) {
    if (isMuseAttestationDenied(bodyText)) {
      return {
        status: response.status,
        message: MUSE_CODE_ATTESTATION_DENIED_MESSAGE,
        errorBody: bodyText
      };
    }
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  /**
   * Meta refuses a credential that is not entitled to the requested surface
   * with `client_attestation_denied`. A key reminted from the same device
   * token carries the same scope, so the refusal is surfaced as it arrived:
   * no remint, no substituted credential and no second attempt. The remedy is
   * a credential change, never a retry.
   */
  shouldRefreshAfterAuthFailure(parsedError) {
    return !isMuseAttestationDenied(parsedError?.errorBody);
  }
}

export default MuseCodeExecutor;
