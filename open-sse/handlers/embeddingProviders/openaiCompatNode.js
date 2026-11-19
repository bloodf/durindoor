// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  // LAN nodes may run without a key; send Authorization only when one is configured.
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    const token = creds?.apiKey || creds?.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  },
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = rawBaseUrl.replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
};
