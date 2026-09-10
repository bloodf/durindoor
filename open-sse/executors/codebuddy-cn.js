import { DefaultExecutor } from "./default.js";
import { OPENAI_BLOCK, ROLE } from "../translator/schema/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;

function flattenText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => isString(block?.text) ? block.text : "").join("\n");
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
    // and rejects the whole request. Detect agent system prompts via the
    // identity-marker regex and replace them with a neutral one, while leaving
    // legitimate user system prompts untouched. Content may be a string or typed
    // blocks ([{type:"text",text}]), so flatten before matching and preserve the
    // original shape on replacement.
    const transformed = super.transformRequest(model, body, stream, credentials, requestContext);
    transformed.stream = true;

    if (Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.map((message) => {
        if (!message || message.role !== ROLE.SYSTEM) return message;
        const text = flattenText(message.content);
        if (!text) return message;

        if (!AGENT_PATTERN.test(text)) return message;

        console.warn("[codebuddy-cn] system prompt replaced: IDENTITY rule");
        return {
          ...message,
          content: isString(message.content) ?
          NEUTRAL_PROMPT :
          [{ type: OPENAI_BLOCK.TEXT, text: NEUTRAL_PROMPT }]
        };
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