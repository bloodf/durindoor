

## Public guide provenance before main integration

A continued turn sends only the messages after the reply. Anything else (an edited history, another session with the same opener, a different reply, an expired conversation, a connection without an id, a failed earlier turn) starts a fresh conversation with the whole history. Continuations are kept in process memory, so a restart starts fresh conversations, and two connections never share one. This also covers individual (personal) tier connections. The separate personal service, Copilot Web, still opens a new conversation per request; the pinned OmniRoute source has no reuse for it either.

OmniRoute's own turn transport (frame-size limits, a stop frame on cancel) and its single retry of a dropped turn in a fresh conversation are not ported; DurinDoor keeps its own socket loop. Token counts are gateway estimates.

Ported from OmniRoute (`cheaper-inference/OmniRoute`, MIT) at [`4265bb2ad5477450a07d3a43ea33a62c6c874878`](https://github.com/cheaper-inference/OmniRoute/tree/4265bb2ad5477450a07d3a43ea33a62c6c874878): the native sign-in provider and attempt store, `copilot-m365-connection.ts` refresh helpers, `m365Protocol/conversations.ts`, `images.ts` and `tools.ts`. Image generation (`m365ImageGeneration.ts`, `m365Protocol/imageGeneration.ts`), citations (`m365Protocol/citations.ts`), the turn composer (`m365Protocol/composer.ts`), typed turn errors (`m365Turn.ts`, `m365ExecutorOutput.ts`) and model profiles (`m365Protocol/profile.ts`) are ported from [`5ffa68e835442a12ed1204a2eebf4076c298aecb`](https://github.com/cheaper-inference/OmniRoute/tree/5ffa68e835442a12ed1204a2eebf4076c298aecb). See also the web-cookie guide for pasting a session.
