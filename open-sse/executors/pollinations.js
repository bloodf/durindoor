import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * PollinationsExecutor routes OpenAI-compatible chat requests to the current
 * gen.pollinations.ai gateway and only enables jsonMode for explicit JSON
 * response formats. Pollinations rejects ordinary prompts when jsonMode is set
 * unconditionally.
 */
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
      "Content-Type": "application/json",
    };

    const key = credentials.apiKey || credentials.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream) {
    if (!body || typeof body !== "object") return body;
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
