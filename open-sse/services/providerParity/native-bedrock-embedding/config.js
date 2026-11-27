// Ported from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/embeddingRegistry.ts and handlers/bedrockEmbeddings.ts.
import { isString } from "../../../../src/shared/utils/typeChecks.js";
export const BEDROCK_PROVIDER_ID = "bedrock";
export const BEDROCK_AUTH_HEADER = "Authorization";
export const BEDROCK_AUTH_SCHEME = "Bearer";
export const BEDROCK_ORIGIN = "https://bedrock-runtime.us-east-1.amazonaws.com";
export const BEDROCK_URL_TEMPLATE = "https://bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke";
export const BEDROCK_EMBEDDING_MODELS = Object.freeze([
  { id: "amazon.titan-embed-text-v2:0", name: "Titan Text Embeddings V2", dimensions: 1024 },
  { id: "amazon.titan-embed-text-v1", name: "Titan Text Embeddings G1", dimensions: 1536 },
  { id: "amazon.titan-embed-image-v1", name: "Titan Multimodal Embeddings G1", dimensions: 1024 },
  { id: "cohere.embed-v4:0", name: "Cohere Embed v4", dimensions: 1536 },
  { id: "cohere.embed-english-v3", name: "Cohere Embed English v3", dimensions: 1024 },
  { id: "cohere.embed-multilingual-v3", name: "Cohere Embed Multilingual v3", dimensions: 1024 },
].map(model => Object.freeze({ ...model, kind: "embedding" })));
export function bedrockRegion(credentials) {
  const data = credentials?.providerSpecificData;
  const explicit = data?.region;
  if (explicit !== undefined) {
    if (!isString(explicit) || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(explicit)) throw new Error("Invalid Bedrock region");
    return explicit;
  }
  try {
    const url = new URL(data?.baseUrl);
    const match = /^bedrock(?:-runtime|-mantle)?\.([a-z]{2}(?:-gov)?-[a-z]+-\d+)\.amazonaws\.com$/.exec(url.hostname);
    if (match) return match[1];
  } catch { /* Missing URLs use the source default. */ }
  return "us-east-1";
}
export function bedrockUrl(model, credentials) {
  return BEDROCK_URL_TEMPLATE.replace("{region}", bedrockRegion(credentials)).replace("{model}", encodeURIComponent(model));
}
