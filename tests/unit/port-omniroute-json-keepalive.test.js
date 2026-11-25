import { describe, it, expect, vi } from 'vitest';
import { withEarlyJsonKeepalive, resolveJsonKeepaliveThresholdMs } from '../../open-sse/utils/earlyJsonKeepalive.js';

describe('OmniRoute #21087 non-stream JSON keepalive', () => {
  it('preserves fast responses and supports disabling', async () => {
    const response = new Response('bad', { status: 400 });
    expect(await withEarlyJsonKeepalive(Promise.resolve(response), { thresholdMs: 10 })).toBe(response);
    expect(resolveJsonKeepaliveThresholdMs({ OMNIROUTE_NONSTREAM_KEEPALIVE_MS: '0' })).toBe(0);
  });
  it('writes whitespace before a slow JSON response and forwards late errors', async () => {
    vi.useFakeTimers();
    try {
      let finish;
      const pending = new Promise(resolve => { finish = resolve; });
      const wrapped = withEarlyJsonKeepalive(pending, { thresholdMs: 100, intervalMs: 250 });
      await vi.advanceTimersByTimeAsync(100);
      const response = await wrapped;
      const reader = response.body.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(' ');
      await vi.advanceTimersByTimeAsync(250);
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(' ');
      finish(Response.json({ error: 'late' }, { status: 429 }));
      expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual({ error: 'late' });
      expect(response.status).toBe(200);
      expect((await reader.read()).done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
