# DurinDoor cookie capture extension

A small Manifest V3 extension that hands one signed-in provider session from your browser to your own DurinDoor dashboard. It implements the client side of the [provider cookie import contract](../../src/lib/providers/cookieImport/README.md). It is opt-in and one shot: nothing runs until you open its popup on a supported provider tab, paste a pairing and confirm.

Supported: ChatGPT Web, ChatGPT Web Codex, Claude Web, Gemini Web, Doubao Web, Z.ai Web, MaxAI, Arena, ChatPlayground, Perplexity Web, Grok Web, Muse Spark Web, Tencent Yuanbao Web, PromptQL, Notion AI Web, NoTrack Web, Tencent AI Studio Web, Blackbox Web, Conol Web, TinyCMS Web and DeepSeek Web. The list and the approved cookie names (and, for TinyCMS and DeepSeek, the one localStorage item) are compiled into `providers.js` and checked against the dashboard contract by a unit test.

## What it will and will not do

| Rule | How it is kept |
| --- | --- |
| User initiated | Popup only. No service worker, content script, alarm or message listener, so nothing can run in the background. |
| Supported tab | The active tab's origin must equal the provider origin from the built-in table. |
| Explicit confirmation | The popup shows provider, provider site, dashboard origin, target and cookie names. The Send button stays disabled until you tick a checkbox naming the provider site and the dashboard. `runCapture` refuses anything that does not equal what was shown. |
| Narrow, temporary permissions | The manifest has no `host_permissions`. Cookie access (`cookies`), script injection (`scripting`, only for a localStorage provider) and the two host patterns, the provider site and the paired dashboard, are optional and requested only when you click Send. After the run the extension removes whatever that run was granted. A grant you made earlier is neither requested again nor removed. |
| Only allowed cookies | One `cookies.get` per approved name (and contiguous `.0`, `.1`… chunks), inside the cookie store that owns the tab. It never lists the jar. A pairing can only narrow the built-in list. Insecure cookies and cookies from another domain are dropped. |
| Only allowed localStorage items | Only for a provider whose built-in entry names `localStorageKeys` (TinyCMS `app-config-uuid`, DeepSeek Web `userToken`). The optional `scripting` permission and the provider host are requested at Send, and one `chrome.scripting.executeScript` runs `readLocalStorageItems` in the confirmed tab's top frame. It calls `getItem` for the built-in names only and writes nothing. The reader gets the confirmed provider origin and returns nothing unless the page's `location.origin` matches it exactly; the tab URL is also checked just before and just after the injection, and a navigation away stops the run with nothing sent. The pairing must name every built-in item. |
| Only the paired dashboard | One `POST` to the pairing's `importUrl`, which must be HTTPS (or `http` to `localhost`, `127.0.0.1`, `[::1]`) with the exact path `/api/providers/cookie-import`. No credentials, cookies or redirects are followed. |
| No retry | A denied permission, expired pairing or any server answer stops with a fixed message. You must create a new pairing and click again. The secret is wiped from memory once it has been sent. |
| No persistence, telemetry or logging | No `storage` permission, no `console` calls, no other network request. Cookie values and the pairing secret exist only in memory for the length of one run. |

## Install

The extension has no build step.

**Load unpacked** (simplest): open `chrome://extensions`, turn on Developer mode, choose Load unpacked and select this directory, `extensions/provider-cookie-capture`.

**From a package**: build the reproducible zip, unpack it somewhere you keep, and load that folder the same way.

```bash
node scripts/package-cookie-extension.mjs --check
# writes extensions/provider-cookie-capture/dist/durindoor-cookie-capture-<version>.zip and .sha256
```

The zip is deterministic (sorted files, no compression, fixed timestamps), so the same sources always give the same SHA-256. `--check` builds twice and fails if they differ. `--out <dir>` changes the output folder. Compare the printed checksum with the `.sha256` file before sharing a package.

## Use

1. In the dashboard as an operator, create a pairing with `POST /api/providers/cookie-import/pairing` (see [Management API](../../docs/reference/management-api.mdx)). The secret is shown once and lasts two minutes.
2. Sign in to the provider in a tab and keep that tab active.
3. Open the extension, paste the whole pairing response (or its `pairing` object) and choose **Review**.
4. Check the provider and dashboard, tick the confirmation and choose **Send cookies**. The browser asks for permission for the two origins; allow it.
5. Run **Validate** on the connection in the dashboard. The import checks only the shape of the cookies.

If the dashboard rejects the pairing, or anything fails after the request went out, create a new pairing. Cancel discards the pairing and aborts an in-flight request.

## Limits

- Chromium browsers with Manifest V3 only. It has not been run in a real browser; the tests drive mocked `chrome.*` and `fetch` only.
- The dashboard origin cannot be known in advance, so the manifest lists `https://*/*` and loopback `http` patterns as *optional*. The code requests only the paired dashboard host, and removes the grant afterwards. Chrome host patterns ignore ports, so a grant for a host covers every port on it until it is removed. The `http://[::1]/*` pattern relies on the browser accepting IPv6 literals; use `localhost` otherwise.
- The pairing store is per DurinDoor process; run one process behind the address the extension uses.

## Tests

`tests/unit/provider-cookie-capture-extension.test.js`.

If cookie access is revoked after Review or a cookie read fails, Send reports permission denial without sending cookies. You can retry from the review screen or cancel to discard the pairing.
