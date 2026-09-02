export const MODEL_OPTIONS = [
  {
    value: "claude/claude-fable-5",
    label: "Claude Fable 5",
    hint: "claude",
  },
  {
    value: "cx/gpt-5.6-sol",
    label: "gpt-5.6-sol",
    hint: "cx",
  },
  {
    value: "kimi/kimi-k3",
    label: "kimi-k3",
    hint: "kimi",
  },
  {
    value: "minimax/MiniMax-M3",
    label: "MiniMax-M3",
    hint: "minimax",
  },
  {
    value: "ollama-local/llama3.2:1b",
    label: "llama3.2:1b",
    hint: "ollama-local",
  },
];

export const CONNECTION_OPTIONS = [
  { value: "auto", label: "Auto", icon: "route" },
  { value: "account-1", label: "Account 1", icon: "person" },
  { value: "account-2", label: "Account 2", icon: "person" },
];

export const EFFORT_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export const SUGGESTIONS = [
  "Summarize SSE streaming",
  "Show a combo fallback example",
  "Explain RTK compression",
];

export const CONVERSATION = [
  {
    id: "message-1",
    role: "user",
    content: "Show a combo fallback example for Claude Fable 5.",
  },
  {
    id: "message-2",
    role: "assistant",
    content:
      "A combo tries each configured route in order, moving on when an account is unavailable or the provider returns a retryable error.",
    code: `{
  "model": "combo/reliable-claude",
  "messages": [{ "role": "user", "content": "Hello" }]
}`,
  },
  {
    id: "message-3",
    role: "user",
    content: "Does the response still use OpenAI-compatible SSE?",
  },
  {
    id: "message-4",
    role: "assistant",
    content:
      "Yes. DurinDoor normalizes the selected provider stream and returns standard data: chunks through the local /v1 endpoint.",
  },
];
