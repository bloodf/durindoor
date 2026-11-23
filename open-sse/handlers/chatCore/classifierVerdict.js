import { isString } from "../../../src/shared/utils/typeChecks.js";
import { FORMATS } from "../../translator/formats.js";
import { CLAUDE_BLOCK } from "../../translator/schema/index.js";

/** Reject malformed classifier replies; compatibility settings still control reasoning visibility. */
export function invalidClassifierVerdict(sourceFormat, body, response) {
  if (sourceFormat !== FORMATS.CLAUDE || body?.stream !== false || !body?.stop_sequences?.includes("</block>")) return false;
  const system = isString(body.system) ? body.system : Array.isArray(body.system) ? body.system.map((part) => part?.text || "").join(" ") : "";
  if (!/security\s+monitor/i.test(system)) return false;
  const text = response?.content?.filter((part) => part.type === CLAUDE_BLOCK.TEXT).map((part) => part.text).join("").trim();
  return text !== "<block>no</block>" && text !== "<block>yes</block>";
}
