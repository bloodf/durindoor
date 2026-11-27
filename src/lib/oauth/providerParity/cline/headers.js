import { isString } from "../../../../shared/utils/typeChecks.js";

/** Preserve only a valid caller-supplied Cline task identity. */
export function applyClineTaskIdentity(headers, clientHeaders = {}) {
  const entry = Object.entries(clientHeaders || {}).find(([name]) => name.toLowerCase() === "x-task-id");
  const candidate = entry?.[1];
  const taskId = isString(candidate) ? candidate.trim() : "";
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "x-task-id") delete headers[name];
  }
  if (taskId && taskId.length <= 256 && !/[\r\n\0]/.test(taskId)) headers["X-Task-ID"] = taskId;
  return headers;
}
