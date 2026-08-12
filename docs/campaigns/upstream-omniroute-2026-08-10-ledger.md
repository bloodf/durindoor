# Upstream OmniRoute port campaign — 2026-08-10

Tracking OmniRoute PRs evaluated for port into the DurinDoor fork during the
2026-08-10 batch. Earlier batches live in sibling ledgers
(`upstream-omniroute-2026-08-04-ledger.md` and earlier).

| Item | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| #10053 — `fix(translator): strip Codex encrypted tool-schema key for Gemini/Antigravity` | PORT | Codex collaboration tools (`spawn_agent`, `send_message`, `followup_task`) mark their `message` parameter schema with `encrypted: true` (Rust `JsonSchema::with_encrypted`); Gemini/Antigravity reject unknown keywords with 400. Mirrors the same `cleanJSONSchemaForAntigravity` pattern already exercised by `multipleOf` (PR e3e3e235f). Worktree `.omc/wt-port-10053` at `faec44193`. | Fork divergence: its recursive unsupported-keyword walker treats every object key as a schema keyword, so adding upstream's `"encrypted"` removal also deletes valid `properties.encrypted` keys and `required` cleanup drops their entries. Adapted port: context-aware walker preserves every `properties` map key, while recursively stripping unsupported annotations from each property schema. Added regression coverage for top-level and nested `encrypted` properties plus their `required` entries; existing annotation and request-translation coverage remains. |
