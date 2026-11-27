import { afterEach, describe, expect, it, vi } from 'vitest';
import adapter, { config, buildRequest, createRunwayVideoAdapter } from '../../open-sse/services/providerParity/native-runwayml-video/index.js';
const args = { model: 'gen4.5', body: { prompt: 'a river' }, credentials: { id: 'selected', apiKey: 'key-a' } };
const json = value => Response.json(value);
afterEach(() => vi.unstubAllGlobals());
it('pins source metadata and all five static models', () => {
  expect(config).toMatchObject({ id: 'runwayml', aliases: ['runway'], authType: 'bearer', authHeader: 'Authorization', format: 'runwayml' });
  expect(config.models).toEqual(['gen4.5', 'gen4_turbo', 'gen3a_turbo', 'veo3.1', 'veo3.1_fast']);
});
it('sends exact source text wire contract and normalizes safe artifacts with unknown cost', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'task_1' })).mockResolvedValueOnce(json({ status: 'SUCCEEDED', result: [{ uri: 'https://cdn.example.org/video.mp4' }] }));
  vi.stubGlobal('fetch', fetch);
  const result = await adapter.generate(args);
  expect(result.success).toBe(true);
  expect(fetch.mock.calls[0][0]).toBe('https://api.dev.runwayml.com/v1/text_to_video');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer key-a', 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' } });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: 'gen4.5', promptText: 'a river', ratio: '1280:720', duration: 5 });
  expect(fetch.mock.calls[1][0]).toBe('https://api.dev.runwayml.com/v1/tasks/task_1');
  expect(await result.response.json()).toMatchObject({ data: [{ url: 'https://cdn.example.org/video.mp4', format: 'mp4' }] });
  expect(result.accounting).toMatchObject({ nativeUnits: { videos: 1 }, cost: null, costStatus: 'unknown' });
});
it('builds image, ratio, frames and seed source contracts', () => {
  expect(buildRequest('gen4_turbo', { prompt: 'p', image_url: 'https://images.example.org/i.png', aspect_ratio: '9:16', frames: 241, fps: 30, seed: -2 })).toEqual({ path: '/image_to_video', request: { model: 'gen4_turbo', promptText: 'p', promptImage: 'https://images.example.org/i.png', ratio: '720:1280', duration: 8, seed: 0 } });
});
it.each([{ stream: true }, { response_format: 'b64_json' }, { n: 2 }, { video: 'x' }, { image: 'http://127.0.0.1/x' }, { promptImage: {} }, { image_urls: ['https://example.org/a'] }, { duration: '5' }, { provider_options: {} }])('rejects unsupported input before submission %j', async extra => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect((await adapter.generate({ ...args, body: { ...args.body, ...extra } })).success).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it('requires an image for gen4_turbo', () => expect(() => buildRequest('gen4_turbo', args.body)).toThrow());
it('keeps two credentials isolated without token caching', async () => {
  const fetch = vi.fn(async (_url, init) => init.method === 'POST' ? json({ id: 'task' }) : json({ status: 'SUCCEEDED', output: ['https://example.org/v'] }));
  vi.stubGlobal('fetch', fetch);
  await adapter.generate(args);
  await adapter.generate({ ...args, credentials: { id: 'second', accessToken: 'key-b' } });
  expect(fetch.mock.calls.map(c => c[1].headers.Authorization)).toEqual(['Bearer key-a', 'Bearer key-a', 'Bearer key-b', 'Bearer key-b']);
});
it.each([401, 402, 403, 429, 500])('sanitizes HTTP %s and keeps uncertain acceptance honest', async status => {
  const fetch = vi.fn(async () => new Response('secret upstream body key-a', { status })); vi.stubGlobal('fetch', fetch);
  const result = await adapter.generate(args);
  expect(result.success).toBe(false);
  expect(Boolean(result.acceptedJob)).toBe(status >= 500);
  expect(JSON.stringify(result)).not.toContain('key-a');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([{ status: 'FAILED', failure: 'key-a' }, { status: 'SUCCEEDED', output: ['https://127.0.0.1/private'] }, { status: 'SUCCEEDED', output: [] }, { status: 'SUCCEEDED', output: [{}] }, { status: 'alien' }])('retains accepted accounting for failed/unusable tasks %j', async task => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'task' })).mockResolvedValueOnce(json(task)); vi.stubGlobal('fetch', fetch);
  const result = await adapter.generate(args);
  expect(result.acceptedJob.costStatus).toBe('unknown');
  expect(JSON.stringify(result)).not.toContain('key-a');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([{}, { id: '../unsafe' }])('does not replay malformed acceptance', async value => {
  const fetch = vi.fn(async () => json(value)); vi.stubGlobal('fetch', fetch);
  expect((await adapter.generate(args)).acceptedJob).toBeDefined(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('refuses redirects without replay', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })); vi.stubGlobal('fetch', fetch);
  expect((await adapter.generate(args)).acceptedJob).toBeDefined(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('bounds a hung submit and aborts transport without replay', async () => {
  const fetch = vi.fn(() => new Promise(() => {})); vi.stubGlobal('fetch', fetch);
  const result = await createRunwayVideoAdapter({ requestTimeoutMs: 5 }).generate(args);
  expect(result.acceptedJob).toBeDefined(); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it('bounds total polling and caller cancellation', async () => {
  const fetch = vi.fn(async (_url, init) => json(init.method === 'POST' ? { id: 'task' } : { status: 'RUNNING' })); vi.stubGlobal('fetch', fetch);
  expect((await createRunwayVideoAdapter({ timeoutMs: 10 }).generate(args)).acceptedJob).toBeDefined();
  const controller = new AbortController(); controller.abort(); fetch.mockClear();
  expect((await adapter.generate({ ...args, signal: controller.signal })).acceptedJob).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
  const active = new AbortController();
  fetch.mockImplementation(() => { active.abort(); return new Promise(() => {}); });
  expect((await adapter.generate({ ...args, signal: active.signal })).acceptedJob).toBeDefined();
});
it('aborts an in-flight poll without another submit', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'task' })).mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const result = await createRunwayVideoAdapter({ requestTimeoutMs: 5 }).generate(args);
  expect(result.acceptedJob).toBeDefined();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
});
it('sanitizes malformed JSON and network failures without replay', async () => {
  for (const respond of [() => Promise.resolve(new Response('{secret-key-a')), () => Promise.reject(new Error('key-a'))]) {
    const fetch = vi.fn(respond); vi.stubGlobal('fetch', fetch);
    const result = await adapter.generate(args);
    expect(result.acceptedJob).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('key-a');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
// Isolated registration block: the positive registry identity checks.
describe('canonical registration (isolated)', () => {
  it('registers the default adapter on runwayml and runway with every source video model', async () => {
    const { getVideoGenerationAdapter } = await import('../../open-sse/handlers/videoProviders/index.js');
    const { default: runwayRegistry } = await import('../../open-sse/providers/registry/runwayml.js');
    expect(getVideoGenerationAdapter('runwayml')).toBe(adapter);
    expect(getVideoGenerationAdapter('runway')).toBe(adapter);
    expect(runwayRegistry.id).toBe(config.id);
    expect(runwayRegistry.aliases).toEqual(config.aliases);
    expect(runwayRegistry.authType).toBe('apikey');
    expect(runwayRegistry.serviceKinds).toEqual(['image', 'video']);
    expect(runwayRegistry.models.filter(m => m.kind === 'video').map(m => m.id).sort()).toEqual([...config.models].sort());
    expect(runwayRegistry.videoConfig).toBeUndefined();
  });
});
