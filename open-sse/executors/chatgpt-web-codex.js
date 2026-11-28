import { ChatGptWebExecutor } from "./chatgpt-web.js";
import { prepareChatGptWebBrowserRequest } from "../utils/chatgptWebExecutorAdapter.js";
import { errorResponse } from "../utils/error.js";

// The upstream Codex catalog exposes performance lanes; DurinDoor routes them
// through its existing ChatGPT Web HTTP conversation implementation, which
// handles cookie exchange, Sentinel, cumulative SSE conversion, and quota/auth
// status preservation. Connection state and token caches remain keyed by cookie.
const MODEL_LANES = Object.freeze({
  luna: "gpt-5.6-luna-free",
  think: "gpt-5.6-luna-free-thinking",
  instant: "gpt-5.6-sol-instant",
  medium: "gpt-5.6-sol-medium",
  high: "gpt-5.6-sol-high",
  "extra-high": "gpt-5.6-sol-xhigh",
  pro: "gpt-5.6-sol-pro",
});

export class ChatGptWebCodexExecutor extends ChatGptWebExecutor {
  constructor(deps = {}) {
    super(deps);
    this.id = "chatgpt-web-codex";
  }

  /** Validate against the existing browser selection catalog before any transport
   * can exchange a cookie or submit a conversation, including explicit HTTP.
   * A minimal request isolates model validation from transport-specific features.
   */
  execute(input) {
    const model = typeof input.model === "string" && Object.hasOwn(MODEL_LANES, input.model)
      ? MODEL_LANES[input.model] : input.model;
    try {
      if (typeof model !== "string") throw new Error("Invalid model");
      prepareChatGptWebBrowserRequest(model, { messages: [{ role: "user", content: "validation" }] });
    } catch {
      return Promise.resolve({
        response: errorResponse(400, "Unsupported ChatGPT Web Codex model", { type: "invalid_request", code: "UNSUPPORTED_MODEL" }),
        url: "https://chatgpt.com",
        headers: {},
        transformedBody: input.body,
      });
    }
    return super.execute({ ...input, model, sameOriginRedirects: true });
  }
}

export { MODEL_LANES };
