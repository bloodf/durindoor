import { ChatGptWebExecutor } from "./chatgpt-web.js";

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

  execute(input) {
    const model = MODEL_LANES[input.model] ?? input.model;
    return super.execute({ ...input, model, sameOriginRedirects: true });
  }
}

export { MODEL_LANES };
