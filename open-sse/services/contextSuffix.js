import { isString } from "../../src/shared/utils/typeChecks.js";

/** Remove Claude Code's recognized context-window hint before upstream dispatch. */
export function stripRecognizedContextSuffix(value) {
  return isString(value) ? value.replace(/(?:\[1m\]|-1m)$/i, "") : value;
}
