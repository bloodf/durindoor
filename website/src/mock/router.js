// Tiny method + path-pattern router. Patterns use `:name` for one segment
// and `*name` for the rest of the path, e.g. `/api/providers/:id/models`.

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      if (segment.startsWith("*")) {
        keys.push(segment.slice(1) || "rest");
        return "(.*)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

function specificity(pattern) {
  // Literal segments beat params, params beat splats.
  return pattern.split("/").reduce((score, segment) => {
    if (segment.startsWith("*")) return score;
    if (segment.startsWith(":")) return score + 1;
    return score + 3;
  }, 0);
}

export function createRouter() {
  let routes = [];

  const add = (method) => (pattern, handler) => {
    const entry = { method, pattern, handler, ...compile(pattern), score: specificity(pattern) };
    routes = [...routes, entry].sort((a, b) => b.score - a.score);
  };

  function match(method, pathname) {
    for (const route of routes) {
      if (route.method !== "ANY" && route.method !== method) continue;
      const found = route.regex.exec(pathname);
      if (!found) continue;
      const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(found[index + 1] ?? "")]));
      return { route, params };
    }
    return null;
  }

  return {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    patch: add("PATCH"),
    delete: add("DELETE"),
    any: add("ANY"),
    match,
    size: () => routes.length,
  };
}
