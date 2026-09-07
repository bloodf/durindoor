import React, { forwardRef } from "react";
import { isString } from "../src/shared/utils/typeChecks.js";
import { useRouter } from "./next-navigation.js";

/** Anchor semantics with fixture-local routing; never runs Next server/client bootstrap. */
export default forwardRef(function StoryLink({ href, replace, prefetch, scroll, shallow, locale, legacyBehavior, passHref, onClick, children, ...props }, ref) {
  const router = useRouter();
  const query = href?.query ? new URLSearchParams(Object.entries(href.query).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((item) => [key, String(item)]))).toString() : "";
  const destination = isString(href) ? href : `${href?.pathname || "/"}${href?.search || (query ? `?${query}` : "")}${href?.hash || ""}`;
  return <a {...props} ref={ref} href={destination} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download) return;
    const url = new URL(destination, location.origin);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    router[replace ? "replace" : "push"](`${url.pathname}${url.search}${url.hash}`);
  }}>{children}</a>;
});
