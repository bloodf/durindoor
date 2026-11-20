# 1073: Native Responses terminal snapshots

The empty-stream terminal guard introduced by #2085 replaced a valid native `response.completed` with `response.failed` when the only output text was in `response.output` and usage was absent. The completion callback also classified that response as empty, potentially triggering a provider cooldown.

Native Responses success snapshots now count message output text and refusals, and function or custom tool calls with actual tool content, as output. Arbitrary metadata and configuration text do not count. The original terminal frame and usage remain intact; no snapshot content is emitted as an additional delta. Genuine empty successes still fail, provider failures remain failures, and existing delta, replay, and low-output behavior is preserved. The focused offline test covers these boundaries and completion classification.
