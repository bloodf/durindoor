// Providers whose 429 body prose stamps a naive (offset-less) reset
// timestamp (`Your limit will reset at 2026-08-17 02:56:15`) in a zone other
// than UTC. Z.AI/BigModel GLM actually stamp Asia/Shanghai (+08:00); reading
// that as UTC adds 8 phantom hours to a 5-hour quota cooldown (OmniRoute
// #14542). Registry entries (zai/glm/glm-cn/glmt) declare `naiveResetTimezone`
// from this map, and error.js absoluteResetFromText() reads it back by
// provider id — this file has no other imports so neither side drags in the
// other's dependency graph (registries pull in transport config;
// utils/error.js is imported almost everywhere and must stay light).
export const NAIVE_RESET_TIMEZONES = Object.freeze({
  zai: "+08:00",
  glm: "+08:00",
  "glm-cn": "+08:00",
  glmt: "+08:00"
});
