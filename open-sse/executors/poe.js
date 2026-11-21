import { BaseExecutor } from "./base.js";
import { errorResponse } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { PROVIDERS } from "../config/providers.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

function errorResult(status, message, body, url) {
  return { response: errorResponse(status, message), url, headers: {}, transformedBody: body };
}

export function isPoeMessagesModel(model) {
  return isString(model) && /(?:^|[\/._-])claude(?:[\/._-]|$)/i.test(model);
}

export class PoeExecutor extends BaseExecutor {
  constructor(fetcher = proxyAwareFetch) {
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
    let response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": key,
          Accept: stream === false ? "application/json" : "text/event-stream",
        },
        body: JSON.stringify(payload),
      }, proxyOptions);
    } catch {
      return errorResult(502, "Poe connection failed", body, url);
    }
    if (!response.ok) {
      return errorResult(response.status, `Poe API error (${response.status})`, body, url);
    }
    return { response, url, headers: {}, transformedBody: payload };
  }
}
