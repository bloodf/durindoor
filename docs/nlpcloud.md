# NLP Cloud

Add an NLP Cloud API key using the normal provider connection form. NLP Cloud accepts Bearer authentication. Connection testing makes a chatbot request and may consume provider credits; only a successful response confirms the key. See [NLP Cloud pricing](https://nlpcloud.com/pricing.html) for account-specific charges and plans. Models shown in the dashboard are the chatbot models listed in the [NLP Cloud API reference](https://docs.nlpcloud.com/#chatbot-and-conversational-ai); availability depends on the account.

Requests use the model-specific GPU chatbot endpoint. System or developer instructions become the chatbot context, and alternating user and assistant messages become its history. The last message must be from the user. The endpoint supports text and native streaming, but not tools, images, or structured JSON output; these are rejected. The native chatbot response does not report token usage, so the gateway does not fabricate provider usage. Other OpenAI generation parameters are not sent because they are not documented for this endpoint.

The executor and registry were adapted from OmniRoute's `open-sse/executors/nlpcloud.ts` and `open-sse/config/providers/registry/nlpcloud/index.ts` at commit `2c4aa9e9af21e2ad27440c4c478c10282154a596`. The published NLP Cloud catalog and Bearer contract take precedence where they differ.

This integration has been exercised with local mocks only; account-backed behavior has not been verified. The dashboard uses a neutral icon.
