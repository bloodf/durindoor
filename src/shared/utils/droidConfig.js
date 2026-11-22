import { isString } from "./typeChecks.js";

/** Identify DurinDoor entries and the legacy entries written by 9Router. */
export function isDurinDoorDroidModel(model) {
  return isString(model?.id) &&
    (model.id.startsWith("custom:DurinDoor-") || model.id.startsWith("custom:9Router")) ||
    model?.apiKey === "sk_9router" && isString(model?.baseUrl) && model.baseUrl.includes("/v1");
}
