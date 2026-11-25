import { DefaultExecutor } from "./default.js";
import { normalizeCodeBuddyRequest, normalizeCodeBuddyResponse } from "./codebuddy-protocol.js";
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
    return normalizeCodeBuddyRequest(result);
  }

  async execute(options) {
    return normalizeCodeBuddyResponse(await super.execute(options));
  }
}
