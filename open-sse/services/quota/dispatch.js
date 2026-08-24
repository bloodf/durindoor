/** A local capacity/coordinator failure that must never become provider evidence. */
import { isString } from "../../../src/shared/utils/typeChecks.js";
export class QuotaDispatchUnavailableError extends Error {
  constructor(reason = "capacity_exhausted") {
    super("Provider quota capacity unavailable");
    this.name = "QuotaDispatchUnavailableError";
    this.code = "QUOTA_DISPATCH_UNAVAILABLE";
    this.reason = isString(reason) && reason ? reason : "capacity_exhausted";
    this.status = 503;
  }
}

export function isQuotaDispatchUnavailable(error) {
  return error?.code === "QUOTA_DISPATCH_UNAVAILABLE";
}