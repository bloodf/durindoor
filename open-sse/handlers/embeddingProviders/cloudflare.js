import { bearerAuth } from "./_base.js";

const BASE_URL = "https://api.cloudflare.com/client/v4/accounts";

export default {
  /** Build the account-scoped Workers AI embeddings endpoint; never emit a URL with an unresolved account id. */
  buildUrl: (_model, credentials) => {
    const accountId = credentials?.providerSpecificData?.accountId;
    if (!accountId) throw new Error("cloudflare-ai embeddings require accountId in providerSpecificData");
    return `${BASE_URL}/${accountId}/ai/v1/embeddings`;
  },
  buildHeaders: (credentials) => ({
    "Content-Type": "application/json",
    ...bearerAuth(credentials),
  }),
  buildBody: (model, { input, encoding_format, dimensions }) => {
    const body = { model, input };
    if (encoding_format) body.encoding_format = encoding_format;
    if (Number.isFinite(Number(dimensions)) && Number(dimensions) > 0) body.dimensions = Number(dimensions);
    return body;
  },
  normalize: (responseBody) => responseBody,
};
