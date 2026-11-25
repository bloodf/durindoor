import { isBoolean } from "../../../src/shared/utils/typeChecks.js";

/**
 * Declared `strict` of a flat Responses tool or a nested Chat tool, for executor
 * rebuilds. Responses treats an omitted value as strict mode, so false and null
 * (LangChain's opt-out) must survive. Undeclared returns undefined (upstream #4396).
 */
export function readToolStrict(tool) {
  return [tool?.strict, tool?.function?.strict].find((value) => value === null || isBoolean(value));
}
