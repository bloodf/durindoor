// Pure request fixtures shared by the opt-in matrix and its offline contract tests.
// Tiny 1x1 transparent PNG (data URI body + raw base64) for multimodal scenarios.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URI = `data:image/png;base64,${PNG_B64}`;

// ---- Body builders: per format x scenario (full, spec-correct shapes) ----

const COMMON = { temperature: 0.3, top_p: 0.9, max_tokens: 256 };
// Reasoning models often reject custom temperature (must be default/1) -> omit sampling.
const REASON_TOK = { max_tokens: 1024 };

// OpenAI Chat Completions
const openaiBody = {
  basic: () => ({
    ...COMMON, stream: true, stream_options: { include_usage: true },
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "Reply with the single word: hi" },
    ],
  }),
  multimodal: () => ({
    ...COMMON, stream: true,
    messages: [
      { role: "system", content: "Describe images briefly." },
      { role: "user", content: [
        { type: "text", text: "What color dominates this image? One word." },
        { type: "image_url", image_url: { url: PNG_DATA_URI } },
      ] },
    ],
  }),
  tools: () => ({
    ...COMMON, stream: true, tool_choice: "auto",
    tools: [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
    messages: [
      { role: "user", content: "Weather in Paris?" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: '{"temp":"20C"}' },
      { role: "user", content: "Summarize in one short sentence." },
    ],
  }),
  reasoning: () => ({
    ...REASON_TOK, stream: true, reasoning_effort: "low",
    messages: [{ role: "user", content: "What is 17 + 26? Reply with just the number." }],
  }),
};

// OpenAI Responses API
const responsesBody = {
  basic: () => ({
    ...COMMON, stream: true, max_output_tokens: 256,
    instructions: "You are concise.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with the single word: hi" }] }],
  }),
  multimodal: () => ({
    ...COMMON, stream: true, max_output_tokens: 256,
    instructions: "Describe images briefly.",
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: "What color dominates? One word." },
      { type: "input_image", image_url: PNG_DATA_URI },
    ] }],
  }),
  tools: () => ({
    ...COMMON, stream: true,
    tools: [{ type: "function", name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Weather in Paris?" }] },
      { type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"Paris"}' },
      { type: "function_call_output", call_id: "call_1", output: '{"temp":"20C"}' },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Summarize in one short sentence." }] },
    ],
  }),
  reasoning: () => ({
    ...REASON_TOK, stream: true, max_output_tokens: 1024, reasoning: { effort: "low" },
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "What is 17 + 26? Just the number." }] }],
  }),
};

// Anthropic Messages (Claude)
const claudeBody = {
  basic: () => ({
    ...COMMON, stream: true,
    system: [{ type: "text", text: "You are concise." }],
    messages: [{ role: "user", content: "Reply with the single word: hi" }],
  }),
  multimodal: () => ({
    ...COMMON, stream: true,
    system: [{ type: "text", text: "Describe images briefly." }],
    messages: [{ role: "user", content: [
      { type: "text", text: "What color dominates? One word." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
    ] }],
  }),
  tools: () => ({
    ...COMMON, stream: true,
    tools: [{ name: "get_weather", description: "Get weather", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    messages: [
      { role: "user", content: "Weather in Paris?" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"temp":"20C"}' }] },
      { role: "user", content: "Summarize in one short sentence." },
    ],
  }),
  reasoning: () => ({
    ...REASON_TOK, stream: true, thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [{ role: "user", content: "What is 17 + 26? Just the number." }],
  }),
};

// Gemini generateContent
const geminiBody = {
  basic: () => ({
    systemInstruction: { parts: [{ text: "You are concise." }] },
    contents: [{ role: "user", parts: [{ text: "Reply with the single word: hi" }] }],
    generationConfig: { maxOutputTokens: 256, temperature: 0.3, topP: 0.9 },
  }),
  multimodal: () => ({
    systemInstruction: { parts: [{ text: "Describe images briefly." }] },
    contents: [{ role: "user", parts: [
      { text: "What color dominates? One word." },
      { inlineData: { mimeType: "image/png", data: PNG_B64 } },
    ] }],
    generationConfig: { maxOutputTokens: 256 },
  }),
  tools: () => ({
    tools: [{ functionDeclarations: [{ name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] }],
    contents: [
      { role: "user", parts: [{ text: "Weather in Paris?" }] },
      { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Paris" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { temp: "20C" } } }] },
      { role: "user", parts: [{ text: "Summarize in one short sentence." }] },
    ],
    generationConfig: { maxOutputTokens: 256 },
  }),
  reasoning: () => ({
    contents: [{ role: "user", parts: [{ text: "What is 17 + 26? Just the number." }] }],
    generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 512, includeThoughts: true } },
  }),
};

// Antigravity = Gemini body wrapped in { request, userAgent }.
const wrapAntigravity = (fn) => () => ({ request: fn(), userAgent: "antigravity" });
const antigravityBody = {
  basic: wrapAntigravity(geminiBody.basic),
  multimodal: wrapAntigravity(geminiBody.multimodal),
  tools: wrapAntigravity(geminiBody.tools),
  reasoning: wrapAntigravity(geminiBody.reasoning),
};

export const BUILDERS = {
  openai: openaiBody,
  "openai-responses": responsesBody,
  claude: claudeBody,
  gemini: geminiBody,
  "gemini-cli": geminiBody,
  antigravity: antigravityBody,
};

