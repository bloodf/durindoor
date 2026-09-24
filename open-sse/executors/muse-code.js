import { DefaultExecutor } from "./default.js";
import { isMuseDcaToken } from "../config/museCode.js";
import { refreshMuseCodeToken } from "../services/museCodeAuth.js";

/**
 * Muse Code (Meta) executor. Requests use the OpenAI Responses wire through
 * DefaultExecutor; this class only owns the credential lifecycle. A device
 * login stores the durable `dca:` token and a minted inference key. When the
 * key is missing (the stored access token is still the `dca:` token) or the
 * API rejects it, the key is reminted from the `dca:` token. Pasted
 * META_API_KEY connections carry no `dca:` token and are never reminted.
 */
export class MuseCodeExecutor extends DefaultExecutor {
  constructor() {
    super("muse-code");
  }

  needsRefresh(credentials) {
    if (!credentials?.apiKey && isMuseDcaToken(credentials?.accessToken)) return true;
    return super.needsRefresh(credentials);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshMuseCodeToken(credentials?.refreshToken, credentials?.providerSpecificData, log, proxyOptions);
  }
}

export default MuseCodeExecutor;
