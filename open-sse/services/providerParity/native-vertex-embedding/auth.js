import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { classifyVertexCredential, validateVertexSaKey, VERTEX_CREDENTIAL } from "../../tokenRefresh.js";
import { readBoundedResponseText } from "../../../utils/error.js";
const refuse = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const TOKEN = /^[\x21-\x7e]{1,4096}$/;
/**
 * Source embeddings require SA JSON. Explicit ADC, OAuth and Express keys are
 * refused even though chat supports them. Never consult ambient credentials.
 * Source region maps onto local location; conflicting settings fail closed.
 * Source getVertexHost uses the global host even for regional locations.
 */
export function vertexEmbeddingScope(credentials) {
  const classified = classifyVertexCredential(credentials?.apiKey);
  if (classified.error || classified.kind !== VERTEX_CREDENTIAL.SERVICE_ACCOUNT) refuse("Vertex embeddings require valid Service Account JSON; ADC, OAuth and Express keys are unsupported");
  const sa = structuredClone(classified.json);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(sa.project_id ?? "")) refuse("Vertex embedding project is invalid");
  const psd = credentials?.providerSpecificData ?? {};
  if (psd.projectId && psd.projectId !== sa.project_id) refuse("Vertex embedding project conflicts with the selected account");
  if (psd.region && psd.location && psd.region !== psd.location) refuse("Vertex region and location conflict; migrate the selected connection explicitly");
  const location = psd.location || psd.region || "us-central1";
  if (!isString(location) || !/^(?:global|eu|[a-z]{2,15}-[a-z]{2,15}[1-9][0-9]?)$/.test(location)) refuse("Vertex embedding location is invalid");
  if (validateVertexSaKey(sa)) refuse("Vertex Service Account signing key is invalid");
  return { sa, project: sa.project_id, location, origin: location === "eu" ? "https://aiplatform.eu.rep.googleapis.com" : "https://aiplatform.googleapis.com" };
}
/** Fixed Google publisher and action; no credential-provided URL or publisher. */
export function vertexEmbeddingUrl(scope, model) {
  return `${scope.origin}/v1/projects/${encodeURIComponent(scope.project)}/locations/${encodeURIComponent(scope.location)}/publishers/google/models/${encodeURIComponent(model)}:predict`;
}
/**
 * Private source-backed jose minter: shared refreshVertexToken cannot propagate
 * abort or refuse redirects. No cache, ambient ADC, custom crypto or token URI.
 * The same signal/transport snapshot governs token send and body and prediction.
 */
export async function mintVertexEmbeddingToken(sa, { signal, send, remaining }) {
  const { SignJWT, importPKCS8 } = await import("jose");
  signal.throwIfAborted();
  const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256" };
  if (sa.private_key_id) header.kid = sa.private_key_id;
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever", sub: sa.client_email })
    .setProtectedHeader(header)
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  signal.throwIfAborted();
  const response = await send("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "manual", signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok || response.redirected || (response.url && response.url !== "https://oauth2.googleapis.com/token")) {
    await response.body?.cancel();
    throw new Error("Vertex token exchange refused");
  }
  const text = await readBoundedResponseText(response, { signal, maxBytes: 65536, timeoutMs: remaining(), throwOnTimeout: true });
  const token = JSON.parse(text)?.access_token;
  if (!isString(token) || !TOKEN.test(token) || /^[\[{]/.test(token)) throw new Error("Vertex token exchange unusable");
  return token;
}
