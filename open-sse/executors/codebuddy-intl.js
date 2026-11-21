import { DefaultExecutor } from "./default.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { ROLE } from "../translator/schema/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;

function sanitizeText(text) {
  if (!text || !AGENT_PATTERN.test(text)) return text;
  let replacedIdentity = false;
  return text.split("\n").map((line) => {
    if (!AGENT_PATTERN.test(line)) return line;
    if (!replacedIdentity) {
      replacedIdentity = true;
      return NEUTRAL_PROMPT;
    }
    return line.replace(new RegExp(AGENT_PATTERN.source, "gi"), "");
  }).join("\n");
}

function sanitizeContent(content) {
  if (isString(content)) return sanitizeText(content);
  if (!Array.isArray(content)) return content;
  return content.map((block) => block && isString(block.text)
    ? { ...block, text: sanitizeText(block.text) }
    : block);
}

// OmniRoute bd9b1324 open-sse/executors/codebuddy-intl.ts requires a leading
// system message. Apply identity-line sanitization while retaining its provider
// specific request conversion and leading-system-message behavior.
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() { super("codebuddy-intl"); }

  transformRequest(model, body, stream, credentials, requestContext) {
    const result = super.transformRequest(model, body, stream, credentials, requestContext);
    result.stream = true;
    if (Array.isArray(result.messages)) {
      result.messages = result.messages.map((message) => {
        if (!message || ![ROLE.SYSTEM, ROLE.DEVELOPER].includes(message.role)) return message;
        const content = sanitizeContent(message.content);
        return content === message.content ? message : { ...message, content };
      });
    }
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
