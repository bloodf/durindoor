import { createElement } from "react";
import { docs } from "@source/server";
import { loader } from "fumadocs-core/source";
import { icons } from "lucide-react";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon(name) {
    if (!name) return;
    const Icon = icons[name];
    if (!Icon) return;
    return createElement(Icon, { "aria-hidden": true });
  },
});
