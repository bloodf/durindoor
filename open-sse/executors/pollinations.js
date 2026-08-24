import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * PollinationsExecutor routes OpenAI-compatible chat requests to the current
 * gen.pollinations.ai gateway and only enables jsonMode for explicit JSON
 * response formats. Pollinations rejects ordinary prompts when jsonMode is set
 * unconditionally.
 */import { isObject } from "@/shared/utils/typeChecks.js";
export class PollinationsExecutor extends BaseExecutor {
  constructor() {
    super("pollinations", PROVIDERS.pollinations || { format: "openai" });
  }

  buildUrl(_model, _stream, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || "https://gen.pollinations.ai/v1/chat/completions";
  }

  buildHeaders(credentials = {}, stream = true) {
    const headers = {
      "Content-Type": "application/json"
    };

    // `getProviderCredentials` uses the synthetic `public` access token to
    // represent a keyless provider. It is routing state, not an upstream key.
    const publicFallback = credentials.id === "noauth" || credentials.connectionId === "noauth";
    const key = credentials.apiKey || credentials.accessToken || "";
    const isPlaceholder = publicFallback || key === "public" || key === "sk_durindoor";
    if (key && !isPlaceholder) headers.Authorization = `Bearer ${key}`;
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream) {
    if (!body || !isObject(body)) return body;
    const transformed = { ...body, model, stream };
    const responseFormatType = transformed.response_format?.type;
    if (responseFormatType === "json_object" || responseFormatType === "json_schema") {
      transformed.jsonMode = true;
    } else {
      delete transformed.jsonMode;
    }
    return transformed;
  }
}

export default PollinationsExecutor;