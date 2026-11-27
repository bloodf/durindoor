import { describe, expect, it, vi } from 'vitest';
import provider, { discoverPoeWebModels } from '../../open-sse/providers/private/poe-web.js';
import { PoeWebExecutor, POE_WEB_URL, parsePoeCookie } from '../../open-sse/executors/poe-web.js';

const executor = new PoeWebExecutor();
const input = (apiKey = 'alpha', stream = false) => ({ credentials: { apiKey }, model: 'gpt-4o', stream, body: { messages: [{ role: 'user', content: 'first' }, { role: 'user', content: 'hello' }] } });
const response = (text = 'answer', state = 'complete') => Response.json({ data: { chatWithBot: { text, state } } });
const run = (args, fn = async () => response()) => executor.runSession(args, { sendBillable: fn });

describe('staged Poe web session', () => {
  it('offers only its static mapping without credential capture metadata or API-key identity', () => {
    expect(provider.id).toBe('poe-web');
    expect(provider.cookieImport).toBeUndefined(); expect(provider.webLogin).toBeUndefined();
    expect(discoverPoeWebModels()).toContainEqual({ id: 'gpt-4o', name: 'GPT-4o', toolCalling: false });
    expect(discoverPoeWebModels()).not.toBe(discoverPoeWebModels());
  });
  it('accepts only a safe bare token or one named p-b cookie', async () => {
    expect(parsePoeCookie('Cookie: other=x; p-b=abc==')).toBe('abc==');
    expect(parsePoeCookie('abc==')).toBe('abc==');
    for (const raw of ['', 'other=x', 'p-b=', 'p-b=a; p-b=b', 'abc\r\nInjected: x', 'a b']) {
      expect(parsePoeCookie(raw)).toBeNull();
      const send = vi.fn(); expect((await run(input(raw), send)).response.status).toBe(401); expect(send).not.toHaveBeenCalled();
    }
  });
  it('sends the fixed envelope and only the selected account cookie, and maps JSON', async () => {
    const calls = [];
    const send = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return response(init.headers.cookie); };
    const first = await run(input('other=x; p-b=alpha'), send);
    const second = await run(input('p-b=beta'), send);
    expect(calls.map(c => c.init.headers.cookie)).toEqual(['p-b=alpha', 'p-b=beta']);
    expect(calls[0]).toMatchObject({ url: POE_WEB_URL, init: { method: 'POST', headers: { origin: 'https://www.poe.com', referer: 'https://www.poe.com/', accept: 'application/json' } }, body: { operationName: 'ChatViewQuery', variables: { bot: 'GPT-4o', query: 'hello' } } });
    expect(first.headers.cookie).toBe('[REDACTED]');
    expect((await first.response.json()).choices[0].message.content).toBe('p-b=alpha');
    expect((await second.response.json()).choices[0].message.content).toBe('p-b=beta');
    expect(calls).toHaveLength(2); // one billable send per completion
  });
  it('emits terminal SSE frames for streaming requests', async () => {
    const result = await run(input('alpha', true));
    const text = await result.response.text();
    expect(text).toContain('"content":"answer"'); expect(text).toContain('"finish_reason":"stop"'); expect(text).toContain('data: [DONE]');
  });
  it('rejects expiry, upstream errors, incomplete and malformed responses', async () => {
    for (const upstream of [new Response(null, { status: 401 }), new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } })]) {
      const res = (await run(input(), async () => upstream)).response;
      expect(res.status).toBe(401); expect((await res.json()).error.code).toBe('session_expired');
    }
    for (const upstream of [new Response('no'), Response.json({ errors: [{ message: 'secret' }] }), response('partial', 'pending')]) {
      const res = (await run(input(), async () => upstream)).response;
      expect(res.status).toBe(502); expect(JSON.stringify(await res.json())).not.toContain('secret');
    }
    expect((await run(input(), async () => new Response(null, { status: 429 }))).response.status).toBe(429);
  });
  it('uses the shared transport with manual redirects and never forwards the cookie', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const result = await executor.execute(input());
      expect(result.response.status).toBe(401); expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(POE_WEB_URL);
      expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
    } finally { vi.unstubAllGlobals(); }
  });
});
