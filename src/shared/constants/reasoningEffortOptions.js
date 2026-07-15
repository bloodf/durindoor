import reasoningEfforts from "../../../open-sse/config/reasoningEfforts.json" with { type: "json" };

const formatReasoningEffort = (value) => value === "xhigh"
  ? "XHigh"
  : value[0].toUpperCase() + value.slice(1);

export const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  ...reasoningEfforts.map((value) => ({ value, label: formatReasoningEffort(value) })),
];
