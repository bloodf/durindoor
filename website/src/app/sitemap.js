import { source } from "@site/lib/source.js";
import { SITE_URL } from "@site/lib/site.js";
/** Only publish pages backed by the public MDX collection. */
export default function sitemap() {
  return ["/", ...source.getPages().map((page) => page.url)].map((route) => ({ url: new URL(route, SITE_URL).href }));
}
