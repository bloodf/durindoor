import { AntigravityExecutor } from "./antigravity.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { isRecord } from "../../src/shared/utils/typeChecks.js";

const executor = new AntigravityExecutor();

/** Send a native Cloud Code CountTokens request using the same executor identity as chat. */
export async function countAntigravityTokens({ body, model, credentials, signal = null }) {
  const source = body?.request ? body : translateRequest(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, model, body || {}, false, credentials, "antigravity");
  if (source?.error) return { status: 400 };
  const envelope = executor.transformRequest(model, source, false, credentials || {});
  const request = { ...envelope.request, model: envelope.request.model || model };
  delete request.stream;
  delete request.safetySettings;
  delete request.toolConfig;
  delete request.labels;
  const sanitize = (schema) => {
    if (!isRecord(schema)) return;
    for (const key of ["title", "$schema", "additionalProperties", "default", "examples"]) delete schema[key];
    for (const value of Object.values(schema)) {
      if (Array.isArray(value)) value.forEach(sanitize);
      else sanitize(value);
    }
  };
  for (const tool of request.tools || []) for (const declaration of tool.functionDeclarations || []) sanitize(declaration.parameters);
  const url = `${executor.getBaseUrls()[0]}/v1internal:countTokens`;
  const headers = executor.buildHeaders(credentials || {}, false, null, model);
  const response = await proxyAwareFetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ ...envelope, model: undefined, request }),
    ...(signal ? { signal } : null),
  });
  if (!response.ok) return { status: response.status, response };
  const json = await response.json();
  const tokens = Number(json?.totalTokens);
  return Number.isFinite(tokens) && tokens >= 0 ? { tokens } : { status: 502 };
}
