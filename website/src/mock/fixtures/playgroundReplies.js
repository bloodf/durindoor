// Canned assistant replies for the playground, translator and example cards.
// Replies reference the caller's last message and model so the demo feels live.

function partText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (part.userInputMessage?.content) return part.userInputMessage.content;
  return "";
}

function contentText(content) {
  if (Array.isArray(content)) return content.map(partText).filter(Boolean).join(" ");
  return partText(content);
}

/** Last user-authored text from an OpenAI, Claude, Responses, Gemini or Kiro body. */
export function lastUserText(body) {
  if (!body || typeof body !== "object") return "";
  const inner = body.request && typeof body.request === "object" ? body.request : body;
  if (Array.isArray(inner.messages)) {
    const last = [...inner.messages].reverse().find((message) => message?.role === "user");
    return contentText(last?.content);
  }
  if (typeof inner.input === "string") return inner.input;
  if (Array.isArray(inner.input)) {
    const last = [...inner.input].reverse().find((item) => item?.role === "user" || (item?.type === "message" && item?.role !== "assistant"));
    return contentText(last?.content ?? last);
  }
  if (Array.isArray(inner.contents)) {
    const last = [...inner.contents].reverse().find((item) => item?.role !== "model");
    return contentText(last?.parts);
  }
  const kiro = inner.conversationState?.currentMessage?.userInputMessage?.content;
  if (typeof kiro === "string") return kiro;
  return typeof inner.prompt === "string" ? inner.prompt : "";
}

function quote(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "your message";
  return `"${clean.length > 80 ? `${clean.slice(0, 80).trimEnd()}…` : clean}"`;
}

const CODE_HINT = /\b(code|function|script|implement|write|regex|sql|query|bug|fix|refactor|typescript|javascript|python|rust|go|bash|class|api|endpoint)\b/i;
const EXPLAIN_HINT = /\b(what|why|how|explain|difference|compare|when|should|vs\.?|versus)\b|\?$/i;
const GREETING_HINT = /^\s*(hi|hello|hey|yo|good (morning|evening|afternoon)|greetings)\b/i;

const PYTHON_SNIPPET = [
  "```python",
  "import random",
  "import time",
  "",
  "",
  "def with_retry(task, attempts=4, base_s=0.25):",
  '    """Call task() and retry with exponential backoff and jitter."""',
  "    for attempt in range(attempts):",
  "        try:",
  "            return task(attempt)",
  "        except Exception:",
  "            if attempt == attempts - 1:",
  "                raise",
  "            time.sleep(base_s * 2 ** attempt + random.random() * base_s)",
  "```",
];

function codeReply(prompt, model) {
  if (/\bpython\b/i.test(prompt)) {
    return [`Here is a compact take on ${quote(prompt)}, routed through \`${model}\`.`, "", ...PYTHON_SNIPPET, "", "The jitter keeps concurrent workers from retrying in lockstep; for HTTP 429s, honour `Retry-After` when the provider sends it."].join("\n");
  }
  return [
    `Here is a compact take on ${quote(prompt)}, routed through \`${model}\`.`,
    "",
    "```js",
    "// Retry an async call with exponential backoff and jitter.",
    "export async function withRetry(task, { attempts = 4, baseMs = 250 } = {}) {",
    "  let lastError;",
    "  for (let attempt = 0; attempt < attempts; attempt += 1) {",
    "    try {",
    "      return await task(attempt);",
    "    } catch (error) {",
    "      lastError = error;",
    "      const delay = baseMs * 2 ** attempt + Math.random() * baseMs;",
    "      await new Promise((resolve) => setTimeout(resolve, delay));",
    "    }",
    "  }",
    "  throw lastError;",
    "}",
    "```",
    "",
    "A few notes:",
    "- The jitter keeps concurrent clients from retrying in lockstep.",
    "- Pass `attempt` into the task if you want to log or switch connections per try.",
    "- For 429 responses, prefer the provider's `retry-after` header over the computed delay.",
  ].join("\n");
}

function explainReply(prompt, model) {
  return [
    `Good question. Short version on ${quote(prompt)}:`,
    "",
    "1. **Start from the constraint that actually hurts.** Latency, cost and quality pull in different directions, so pick the one you cannot compromise on first.",
    "2. **Keep a fallback path.** A combo such as `daily-coder` lets the gateway move to the next model when an account is rate limited, without the client noticing.",
    "3. **Measure before tuning.** The usage page shows tokens and cost per model, which usually makes the trade-off obvious within a day.",
    "",
    `This answer came from \`${model}\`. Ask a follow-up if you want a deeper comparison.`,
  ].join("\n");
}

function greetingReply(prompt, model) {
  return `Hello, Balin! You are talking to \`${model}\` through Durindoor. Everything is wired up: send a coding question, ask for an explanation, or paste an error and I will walk through it.`;
}

function generalReply(prompt, model) {
  return [
    `Noted: ${quote(prompt)}.`,
    "",
    `Here is how I would approach it with \`${model}\`: break the request into a small first step you can verify, run it, then iterate. If you share a concrete example (input, expected output, and what happens today), I can give you a precise answer instead of a general one.`,
  ].join("\n");
}

/** Choose a plausible canned reply for the prompt. */
export function cannedReply(prompt, model = "auto") {
  const text = String(prompt || "");
  if (GREETING_HINT.test(text)) return greetingReply(text, model);
  if (CODE_HINT.test(text)) return codeReply(text, model);
  if (EXPLAIN_HINT.test(text)) return explainReply(text, model);
  return generalReply(text, model);
}

/** Split text into word-sized tokens, keeping whitespace attached. */
export function tokenize(text) {
  return String(text).match(/\s*\S+|\s+/g) || [];
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function randomId(prefix, length = 24) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}${out}`;
}
