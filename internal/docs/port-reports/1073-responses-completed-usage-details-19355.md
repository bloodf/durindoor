# Responses completion usage details (#1073)

OmniRoute #19355's behavior commit `017bca7b2bb471175f9daac87bb3a5f6c41290b1` normalizes known counters in present Responses usage detail objects; head `36a117cd5371bb4c11ba883c9287abc6d5ba3941` extracts that logic into a helper. Merge: `f4312cae22c04bc8834bb9e9883a3fc2b085914b`.

The existing local `completedUsage` fills a missing required counter, but drops the entire detail object when that counter is explicitly null or invalid, losing valid sibling fields. This port instead applies the existing nonnegative integer fallback to required counters and to the known optional cache counters only when present. It operates on the translated completion projection, whose detail objects are copies, preserving sibling fields and original usage. Existing input, output, total and exclusive-cache arithmetic remain unchanged. Passthrough and canonical accounting are outside this change.
