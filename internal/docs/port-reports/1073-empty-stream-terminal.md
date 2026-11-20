# #1073 empty stream terminal ordering

Compared OmniRoute [#20610](https://github.com/cheaper-inference/OmniRoute/pull/20610), head `50dfb9d0d8e193d15b01b53378cf0766cb2a4826`, with this fork's streaming pipeline. The client boundary holds an otherwise empty OpenAI, Claude, or Responses success terminal until completion classifies the turn; a failed empty completion receives an in-band error instead. Content, reasoning, tool calls, output usage and existing errors retain their normal handling. A one-second grace releases a terminal if the transport stays open. Completion and cooldown callbacks retain their existing ownership. The guard forwards other complete frames as they arrive.

OmniRoute [#20095](https://github.com/cheaper-inference/OmniRoute/pull/20095), head `db8e10356cd05cd247893ce5e898ff393054cef1`, arms its generic retry on post-tool continuations. No equivalent arming gap exists in the local Antigravity/AGY path: `chatCore.js` wraps every streamed request from those providers with `createEmptyRetryStream`, regardless of message history. Other providers have no equivalent retry path; this port does not add one.

Focused offline coverage is in `tests/unit/empty-stream-terminal-1073.test.js`; the integration gate owns full-suite validation.
