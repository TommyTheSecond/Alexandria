import { expect, it } from 'vitest';
import { verifiedSample } from './sample-download';
it('returns bytes only when their hash matches', async () => {
  const bytes = new TextEncoder().encode('%PDF-test');
  const hash = '0x' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  expect((await verifiedSample(bytes.buffer, hash)).size).toBe(bytes.length);
});
it('rejects a damaged PDF', async () => {
  await expect(verifiedSample(new TextEncoder().encode('HTML error').buffer, '0x' + '0'.repeat(64))).rejects.toThrow('damaged');
});
