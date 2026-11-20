import { isString } from "../../src/shared/utils/typeChecks.js";

// Only the separately protected operator setting is consulted; legacy strategy
// fields are deliberately inert. Return a fresh list for each routing branch.
export function appendComboPrompt(inherited, configured, name) {
  const prompt = configured && Object.prototype.hasOwnProperty.call(configured, name) ? configured[name] : null;
  return isString(prompt) && prompt.trim() ? [...inherited, prompt] : inherited;
}
