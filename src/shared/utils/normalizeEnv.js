"use strict";

/**
 * Port of OmniRoute #6828 (upstream fix for #6824).
 *
 * Docker `-e KEY=` and `env: KEY: ""` set an env var to the EMPTY STRING, not
 * "unset". A blank value then overrides real values the app would otherwise
 * resolve (persisted settings, defaults, auto-generated secrets), and modules
 * that snapshot `process.env.KEY` at import time treat "" as a real value —
 * the container crashes and Docker restarts it in a loop.
 *
 * normalizeProcessEnv() deletes exactly the empty-string entries from
 * process.env BEFORE any app module loads, so "" behaves like "not set".
 * The predicate is deliberately `value === ""` — never falsy/trim — so
 * meaningful strings survive untouched: "0", "false", " ", and any ordinary
 * nonempty value.
 *
 * Idempotent and safe to call more than once.
 */
function normalizeProcessEnv(env = process.env) {
  for (const key of Object.keys(env)) {
    if (env[key] === "") {
      delete env[key];
    }
  }
  return env;
}

module.exports = { normalizeProcessEnv };
