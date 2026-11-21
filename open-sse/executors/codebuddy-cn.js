import { DefaultExecutor } from "./default.js";
import { ROLE } from "../translator/schema/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;

function sanitizeText(text) {
  if (!text || !AGENT_PATTERN.test(text)) return text;
  const lines = text.split("\n");
  let replacedIdentity = false;
  return lines.map((line) => {
    if (!AGENT_PATTERN.test(line)) return line;
    if (!replacedIdentity) {
      replacedIdentity = true;
      return NEUTRAL_PROMPT;
    }
    return line.replace(new RegExp(AGENT_PATTERN.source, "gi"), "");
  }).join("\n");
}

/**
 * CodeBuddyExecutor — talks to https://copilot.tencent.com/v2/chat/completions.
 * CodeBuddy rejects non-stream chat requests (HTTP 400, code 11101), so every
 * request is forced to stream; 9router re-aggregates SSE for JSON clients.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    // Tencent's content filter flags CLI agent system prompts ("You are Claude
    // Code, Anthropic's official CLI...") as prompt injection / sensitive content
    // and rejects the whole request. Replace only matching identity lines while
    // preserving client rules and the original string or typed-block shape.
    const transformed = super.transformRequest(model, body, stream, credentials, requestContext);
    transformed.stream = true;

    if (Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.map((message) => {
        if (!message || ![ROLE.SYSTEM, ROLE.DEVELOPER].includes(message.role)) return message;
        if (isString(message.content)) {
          const content = sanitizeText(message.content);
          if (content !== message.content) console.warn("[codebuddy-cn] system prompt identity lines sanitized");
          return content === message.content ? message : { ...message, content };
        }
        if (Array.isArray(message.content)) {
          let changed = false;
          const content = message.content.map((block) => {
            if (!block || !isString(block.text)) return block;
            const text = sanitizeText(block.text);
            if (text === block.text) return block;
            changed = true;
            return { ...block, text };
          });
          if (changed) console.warn("[codebuddy-cn] system prompt identity lines sanitized");
          return changed ? { ...message, content } : message;
        }
        return message;
      });
    }

    // CodeBuddy only surfaces model reasoning when the request carries the CLI's
    // OpenAI-style params: reasoning_effort + reasoning_summary:"auto". 9router's
    // thinking pipeline sets reasoning_effort only when the client asks, and never
    // sets reasoning_summary — so reasoning never shows. Mirror the CLI here.
    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort; // gateway has no "none" — just omit
    } else if (eff) {
      // Client explicitly asked for reasoning — mirror the CLI's reasoning_summary
      // so CodeBuddy surfaces the model's reasoning.
      transformed.reasoning_summary = "auto";
    }
    // No reasoning requested: leave both unset. Forcing reasoning_effort:"medium"
    // + reasoning_summary on plain requests makes CodeBuddy trip its content
    // filter and return an error (#2071).
    return transformed;
  }
}

export default CodeBuddyExecutor;
