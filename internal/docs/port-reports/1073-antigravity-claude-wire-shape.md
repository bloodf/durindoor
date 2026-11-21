# #1073 Antigravity Claude wire shape

OmniRoute [#2090](https://github.com/cheaper-inference/OmniRoute/pull/2090), head `611f995cf71bb3d10d20d85a2bb088a9009a2491`, merge `4f202f3fa5d0db738306917e0ccb65a9212b791b`, was compared by its first-parent patch with the existing executor and the existing-executors comparison.

Claude requests now retain only supported inner request fields: normalized contents, system instruction, generation configuration, tools and tool configuration, session ID, session metadata, labels and cached content. Internal and unrelated request fields are omitted. Non-Claude requests retain their existing behavior. The existing schema cleanup, limits, fallback, prompt handling and session normalization remain in place.

Unlike the source allowlist, local route metadata (`sessionMetadata`, `labels`, and `cachedContent`) remains available. Local tool configuration is preserved when tools exist, including its calling mode and allowed names, instead of forcing VALIDATED; without tools it remains omitted as before. Local generation and tool normalization remains authoritative rather than importing the source sanitizer.

The focused offline tests exercise the supported fields, omission and non-Claude behavior alongside the existing schema fallback and payload-limit assertions.

Refs #1073
