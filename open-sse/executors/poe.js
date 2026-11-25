import { BaseExecutor } from "./base.js";
import { errorResponse } from "../utils/error.js";
import { createExecutorSender, withBillableDispatch } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { PROVIDERS } from "../config/providers.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

function errorResult(status, message, body, url) {
  return { response: errorResponse(status, message), url, headers: {}, transformedBody: body };
}

export function isPoeMessagesModel(model) {
  return isString(model) && /(?:^|[\/._-])claude(?:[\/._-]|$)/i.test(model);
}

export class PoeExecutor extends BaseExecutor {
  constructor(fetcher = null) {
    super("poe", PROVIDERS.poe);
    this.fetcher = fetcher;
  }

  async execute(input) {
    if (!isPoeMessagesModel(input.model)) return super.execute(input);
    const { model, body, credentials = {}, stream, signal, proxyOptions } = input;
    const url = this.config.messagesUrl || "https://api.poe.com/v1/messages";
    const key = credentials.apiKey || credentials.accessToken;
    if (!key) return errorResult(401, "Poe API key is required", body, url);
    const payload = { ...body, model, stream: stream !== false };
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, async (billed) => {
      let response;
      try {
        response = billed(await sender.sendRequest(url, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": key,
            Accept: stream === false ? "application/json" : "text/event-stream",
          },
          body: JSON.stringify(payload),
        }, proxyOptions, this.fetcher ? { transport: (options) => this.fetcher(url, options, proxyOptions) } : undefined));
      } catch (error) {
        if (signal?.aborted || isQuotaDispatchUnavailable(error)) throw error;
        return errorResult(502, "Poe connection failed", body, url);
      }
      if (!response.ok) {
        return errorResult(response.status, `Poe API error (${response.status})`, body, url);
      }
      return { response, url, headers: {}, transformedBody: payload };
    });
  }
}
