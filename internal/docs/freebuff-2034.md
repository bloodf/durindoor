

## Public guide provenance before main integration

This provider is **unverified**. It is a port of the reverse-engineered client in OmniRoute, not a documented third-party API: Freebuff has not published a supported auth and headless boundary for orchestrators (see [Freebuff issue #947](https://github.com/CodebuffAI/freebuff/issues/947) and the repository note `internal/docs/freebuff-provider-contract.md`). Tests use closed mocks. No live Freebuff account, token or request has been used.

The catalog is the fixed list in OmniRoute and has no discovery endpoint. Each model maps to a Freebuff agent id; an unlisted model id is sent with the generic `base2-free` agent.

- Nothing was run against the live service. The endpoints, the `instanceId` and `runId` shapes, the agent ids, the `FINISH` status values, the 409 meaning, the ad, notice and tier limits, and the model catalog come from OmniRoute's pinned source and may differ from what Freebuff serves today.

- The FINISH status `failed` for a failed chat is DurinDoor's choice. OmniRoute always reports `completed`.

- [OmniRoute freebuff registry entry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/freebuff/index.ts)

- [OmniRoute freebuff executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/freebuff.ts)

- [OmniRoute freebuff sign-in service](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/oauth/providers/freebuff.ts)

- [OmniRoute OAuth constants (FREEBUFF_CONFIG)](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/oauth/constants/oauth.ts)

- [OmniRoute validator](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/providers/validation.ts)
