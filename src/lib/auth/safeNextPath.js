import { isString } from "@/shared/utils/typeChecks.js";const LOGIN_ORIGIN = "http://durindoor.invalid";

export function safeNextPath(value) {
  if (!isString(value) || value[0] !== "/" || value[1] === "/" || value[1] === "\\") return "/dashboard";
  return new URL(value, LOGIN_ORIGIN).origin === LOGIN_ORIGIN ? value : "/dashboard";
}