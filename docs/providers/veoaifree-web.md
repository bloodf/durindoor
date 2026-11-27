# Veo AI Free Web

Veo AI Free Web (`veoaifree-web`, public alias `veo-free`) generates short
videos through the veoaifree.com site. It works anonymously. You can also save
a signed-in veoaifree.com session, which is then used instead.

## Models

`POST /v1/video/generations` with `veo-free/veo` (VEO 3.1) or
`veo-free/seedance`. `/v1/models/video` lists both; the list is static.

## Request

Send `model` and `prompt` (at most 10,000 characters). Optional:

- `aspect_ratio`, or `size` as its alias: `VIDEO_ASPECT_RATIO_LANDSCAPE`
  (default) or `VIDEO_ASPECT_RATIO_PORTRAIT`. If you send both, they must match.
- `n: 1`, `stream: false` and `response_format: "url"`.

Everything else is refused before anything is sent, including `duration`,
`seed`, image or reference inputs, audio options, more than one variation,
streaming and `b64_json` output. `/v1/videos` job polling is not available; use
`/v1/video/generations`.

The response is `{ created, data: [{ url, type: "video" }] }` with the first
public `https` URL the site returns. The video is not downloaded, and the
gateway makes no claim about its format.

## Anonymous mode

With no saved session, requests run anonymously. No cookie, key or
`Authorization` header is sent. The dashboard's proxy card for this provider
applies.

## Saved session mode

1. Sign in at `https://veoaifree.com` in your browser.
2. Open **Dashboard → Providers → Veo AI Free Web** and choose **Import
   cookies**.
3. Paste the site's `Cookie` request header, paste a cURL command copied from
   the browser, pick a HAR file, or send it with the
   [Cookie Capture extension](./cookie-capture-extension.mdx).

Only one cookie is accepted: WordPress's signed-in cookie for this site,
`wordpress_logged_in_<hash>`, from `https://veoaifree.com` itself. WordPress
builds the hash from the site's address setting, so DurinDoor accepts any
32-character lowercase hexadecimal hash after `wordpress_logged_in_`. It must
be a secure, unexpired cookie. Every other cookie in the input is dropped,
including other `wordpress_*` cookies, and input for another site is refused.
If the input holds two `wordpress_logged_in_…` cookies with different hashes,
the import is refused; keep only the session you want.

The Cookie Capture extension reads cookies by exact name only. It finds the
signed-in cookie when the site's address setting is `https` or `http`, with or
without `www`. If it reports that no session cookie was found while you are
signed in, use the Cookie, cURL or HAR import instead.

Each import becomes a session connection under the provider. While at least
one session exists, requests use a saved session. Send
`x-connection-id: <connection id>` to pick one. If no saved session is
available (for example the pinned one is missing or cooling down), the request
fails instead of quietly running anonymously. Delete the sessions to return to
anonymous mode.

The session cookie is sent only on the site's AJAX calls
(`https://veoaifree.com/wp-admin/admin-ajax.php`). The page request that reads
the form token does not carry it, and nothing is sent to the video URL. Two
sessions never share cookies, tokens or jobs.

## Limits, results and usage

Each call to the site has a 30 second limit. After one submit, the gateway
asks for the result every 20 seconds, at most 30 times and for at most 11
minutes in total. Redirects are refused.

Usage records one video per success, with unknown cost and duration. Once the
submit has been sent, any failure is recorded once on the session that sent it
(or as anonymous) with unknown cost, and the request is never resent on
another session, model or combo member. Cancelling the request stops the wait;
it does not cancel the job at the site. Error messages never echo the session
cookie.
