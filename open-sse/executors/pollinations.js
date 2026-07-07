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

    // Pollinations serves a free, no-auth catalog; only forward a bearer
    // token when the caller supplied a real premium key. Reject every
    // synthetic no-auth placeholder DurinDoor may hand us here:
    // `sk_durindoor` (legacy local placeholder), `public` (the accessToken
    // literal from the runtime no-auth credential in
    // src/sse/services/auth.js), and any credential object flagged with
    // `id === "noauth"` (same synthetic credential, checked by shape too in
    // case the placeholder string ever changes). None of these are real
    // credentials — sending them upstream leaks a fake bearer token and can
    // trip Pollinations' abuse detection for public no-auth traffic.
    const NO_AUTH_PLACEHOLDERS = new Set(["sk_durindoor", "public"]);
    const key = credentials?.apiKey || credentials?.accessToken;
    const isSyntheticNoAuth = credentials?.id === "noauth" || (key && NO_AUTH_PLACEHOLDERS.has(key));
    if (key && !isSyntheticNoAuth) headers.Authorization = `Bearer ${key}`;
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
