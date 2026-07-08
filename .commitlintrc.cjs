// Ponytail: upstream cherry-picks from decolua/9router (release-tag
// commits like "# v0.5.20 (2026-07-07)") use a non-conventional form.
// Ignore them strictly by subject pattern so they don't trip the gate,
// but keep all other rules strict. New commits still must follow
// conventional commits.
//
// Upgrade path: when the durindoor fork stops carrying upstream
// release tags, remove the "sync" type-enum entry and the ignores
// block.
//
// JSON cannot express a function for `ignores`, so this is .cjs.

module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "ci",
        "chore",
        "revert",
        "port",
        "merge",
        "sync",
      ],
    ],
    "header-max-length": [0],
    "subject-case": [0],
    "subject-max-length": [2, "always", 100],
    "body-max-line-length": [1, "always", 200],
    "footer-max-line-length": [0],
    // Keep empty-subject / empty-type as errors. The ignores block
    // below excludes upstream release tags (which have no `<type>:`),
    // and durindoor fork's own `sync:` commits have a real type, so the
    // strictness holds for everything else.
    "subject-empty": [2, "never"],
    "type-empty": [2, "never"],
  },
  // commitlint passes the full commit message (subject + body, joined
  // by newlines). Extract the first line (the subject) and match the
  // release-tag pattern. Returning true here skips every rule for
  // that commit.
  ignores: [
    (message) => {
      const subject = (message || "").split(/\r?\n/, 1)[0].trim();
      return /^# v\d+\.\d+\.\d+ \([^)]+\)$/.test(subject);
    },
  ],
};
