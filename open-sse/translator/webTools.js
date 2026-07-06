function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeToolName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getRequestedToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  const names = [];
  const seen = new Set();
  for (const tool of tools) {
    const fn = toRecord(toRecord(tool)?.function);
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push({ original: name, normalized: normalizeToolName(name) });
  }
  return names;
}

function stripCodeFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json|javascript|js|python)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseLooseJsonObject(raw) {
  const trimmed = stripCodeFence(raw);
  const candidates = [
    trimmed,
    trimmed
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null")
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
      .replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const candidate of candidates) {
    try {
      return toRecord(JSON.parse(candidate));
    } catch {
      // Try the next normalized candidate.
    }
  }
  return null;
}

function serializeToolsToPrompt(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  const lines = [];
  for (const tool of tools) {
    const fn = toRecord(toRecord(tool)?.function);
    if (!fn?.name) continue;
    const desc = typeof fn.description === "string" && fn.description ? fn.description : "";
    let params = "";
    try {
      params = fn.parameters ? JSON.stringify(fn.parameters) : "";
    } catch {
      params = "";
    }
    lines.push(
      `- ${fn.name}${desc ? `: ${desc}` : ""}${params ? `\n  parameters: ${params}` : ""}`
    );
  }
  if (lines.length === 0) return "";
  return [
    "You can call tools. To call a tool, reply with a single line containing a <tool> block",
    'with JSON: <tool>{"name": "<tool_name>", "arguments": { ... }}</tool>',
    "Only emit the <tool> block when you actually want to call a tool; otherwise answer normally.",
    "",
    "Available tools:",
    ...lines,
  ].join("\n");
}

function resolveRequestedToolName(emitted, requestedTools) {
  if (requestedTools.length === 0) return emitted;
  const normalized = normalizeToolName(emitted);
  const exact = requestedTools.find(
    (tool) => tool.original === emitted || tool.normalized === normalized
  );
  return exact?.original || null;
}

function stripRanges(text, ranges) {
  let content = text;
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    content = `${content.slice(0, range.start)}${content.slice(range.end)}`;
  }
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

function toArgumentsString(value) {
  if (value === undefined) return "{}";
  if (typeof value === "string") {
    const parsed = parseLooseJsonObject(value);
    return parsed ? JSON.stringify(parsed) : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

export function prepareToolMessages(bodyObj, messages) {
  const requestedTools = bodyObj?.tools;
  const hasTools = Array.isArray(requestedTools) && requestedTools.length > 0;
  if (!hasTools) return { hasTools: false, requestedTools, effectiveMessages: messages };
  return {
    hasTools: true,
    requestedTools,
    effectiveMessages: [
      { role: "system", content: serializeToolsToPrompt(requestedTools) },
      ...messages,
    ],
  };
}

export function parseToolCallsFromText(text, idSeed = "call", requestedTools) {
  const content = String(text ?? "");
  const requestedToolNames = getRequestedToolNames(requestedTools);
  const blockRe = /<tool(?:_call)?(?:\s+[^>]*)?\s*>\s*([\s\S]*?)\s*<\/tool(?:_call)?>/g;
  const toolCalls = [];
  const acceptedRanges = [];
  let match;
  while ((match = blockRe.exec(content)) !== null) {
    const parsed = parseLooseJsonObject(match[1]);
    const emitted = typeof parsed?.name === "string" ? parsed.name : parsed?.command;
    const name = resolveRequestedToolName(emitted, requestedToolNames);
    if (!name) continue;
    toolCalls.push({
      id: `${idSeed}_${toolCalls.length}`,
      type: "function",
      function: { name, arguments: toArgumentsString(parsed.arguments) },
    });
    acceptedRanges.push({ start: match.index, end: blockRe.lastIndex });
  }
  if (toolCalls.length === 0) return { content, toolCalls: null };
  return { content: stripRanges(content, acceptedRanges), toolCalls };
}

export function buildToolAwareResult(rawContent, requestedTools, idSeed = "call") {
  const { content, toolCalls } = parseToolCallsFromText(rawContent, idSeed, requestedTools);
  return {
    content,
    toolCalls,
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}
