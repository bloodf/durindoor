/** CommandCode NDJSON control-event names used by upstream PR #3405 preflight. */
export const COMMANDCODE_EVENT = Object.freeze({
  ERROR: "error",
  FINISH: "finish",
  START: "start",
  START_STEP: "start-step",
  REASONING_START: "reasoning-start",
  REASONING_END: "reasoning-end",
  TEXT_START: "text-start",
  TEXT_END: "text-end",
  TOOL_INPUT_END: "tool-input-end",
  PROVIDER_METADATA: "provider-metadata",
  MESSAGE_METADATA: "message-metadata",
});
