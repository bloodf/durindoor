

## Public guide provenance before main integration

Live capture is unverified. The pinned OmniRoute source forwards the whole Cookie header and names neither a session cookie nor a validation request, so the `sessionid` allowlist that **Import cookies** and the extension use, and the `GET /api/user/info` validation request, are this port's assumptions. Neither was confirmed against a real signed-in capture. If an import with only `sessionid` fails to chat, paste the full Cookie header in the add dialog instead; the executor forwards it unchanged.

- [OmniRoute provider entry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/tencent-aistudio-web/index.ts)

- [OmniRoute executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/tencent-aistudio-web.ts)
