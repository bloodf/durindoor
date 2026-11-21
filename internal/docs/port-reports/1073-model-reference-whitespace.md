# Model reference whitespace (#1073)

Compared OmniRoute #958 head `a668ac7235f53db6f097a0835849a2fcb0794937` and merge `3c8e448ffbf287b6e3f4160933c6ae929fdceba2` using the merge's exact first-parent diff. The merge also changes deployment and credential lookup; those changes are outside this port.

Previously, a padded provider prefix or model name was parsed literally, and a padded bare alias missed its alias lookup, producing an unintended unknown selection. The shared parser now trims the outer reference and the two sides of its first slash. The chat entry point applies the same normalization before combo and auto-combo admission, and model selection uses the normalized reference before resolving aliases. Resolved provider/model identities continue through the existing model allowlist and access-rule checks. Case and nested model namespaces are preserved; empty components remain invalid.

Offline verification: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-model-reference-whitespace.test.js`. Fixtures exercise gateway model selection, aliases, nested names and allow/deny policy decisions without provider traffic.
