const LOGIN_ORIGIN = "http://durindoor.invalid";

export function safeNextPath(value) {
  if (typeof value !== "string" || value[0] !== "/" || value[1] === "/" || value[1] === "\\") return "/dashboard";
  return new URL(value, LOGIN_ORIGIN).origin === LOGIN_ORIGIN ? value : "/dashboard";
}
