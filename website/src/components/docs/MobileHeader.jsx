"use client";

import { Header } from "fumadocs-ui/layouts/docs/slots/header";

// The desktop header is the banner; the mobile bar contains navigation controls.
export function DocsMobileHeader(props) {
  return <nav aria-label="Documentation controls" style={{ display: "contents" }}><Header {...props} role="none" /></nav>;
}
