# NLP Cloud provider port notes (#2034)

Public setup guide: [`docs/providers/nlpcloud.mdx`](../../docs/providers/nlpcloud.mdx).

The executor and registry were adapted from OmniRoute's `open-sse/executors/nlpcloud.ts` and `open-sse/config/providers/registry/nlpcloud/index.ts` at commit `2c4aa9e9af21e2ad27440c4c478c10282154a596`. The published NLP Cloud catalog and Bearer contract take precedence where they differ.

Closed-mock fixtures exercise routing only; account-backed behavior has not been verified.
