import { DefaultExecutor } from "./default.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { ROLE } from "../translator/schema/index.js";

// OmniRoute bd9b1324 open-sse/executors/codebuddy-intl.ts requires a leading
// system message. Do not substitute the China executor's prompt filtering.
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() { super("codebuddy-intl"); }

  transformRequest(model, body, stream, credentials, requestContext) {
    const result = super.transformRequest(model, body, stream, credentials, requestContext);
    result.stream = true;
    if (Array.isArray(result.messages) && result.messages[0]?.role !== ROLE.SYSTEM) {
      result.messages = [{ role: ROLE.SYSTEM, content: "You are a helpful assistant." }, ...result.messages];
    }
    return result;
  }

  async execute(options) {
    const result = await super.execute(options);
    const response = result.response;
    if (!response?.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return result;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    const rewrite = (line) => {
      if (!line.startsWith("data:")) return line;
      try {
        const chunk = JSON.parse(line.slice(5));
        if (!Array.isArray(chunk.choices)) return line;
        for (const choice of chunk.choices) {
          if (choice.finish_reason === "") choice.finish_reason = null;
          const call = choice.delta?.function_call;
          if (call && !call.name && !call.arguments) delete choice.delta.function_call;
        }
        return `data: ${JSON.stringify(chunk)}`;
      } catch { return line; }
    };
    const transform = new TransformStream({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop();
        if (lines.length) controller.enqueue(encoder.encode(lines.map(rewrite).join("\n") + "\n"));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(rewrite(pending)));
      },
    });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    const normalized = new Response(response.body.pipeThrough(transform), { status: response.status, statusText: response.statusText, headers });
    transferProviderAttemptDispatch(response, normalized);
    return { ...result, response: normalized };
  }
}
