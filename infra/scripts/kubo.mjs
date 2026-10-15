// Minimal client for Kubo's RPC API (127.0.0.1:5001 on the onion host; never exposed).
export const DEFAULT_KUBO_API = 'http://127.0.0.1:5001';

export function kuboClient(base = process.env.KUBO_API || DEFAULT_KUBO_API, { timeoutMs = 120_000 } = {}) {
  async function rpc(path, query = {}, body) {
    const url = new URL(`/api/v0/${path}`, base);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = (await res.json()).Message ?? message;
      } catch {}
      throw new Error(`kubo ${path}: ${message}`);
    }
    return res;
  }

  return {
    async pinnedSet() {
      const { Keys } = await (await rpc('pin/ls', { type: 'recursive' })).json();
      return new Set(Object.keys(Keys ?? {}));
    },
    async pin(cid) {
      await rpc('pin/add', { arg: cid, progress: 'false' });
    },
    async unpin(cid) {
      await rpc('pin/rm', { arg: cid });
    },
    /** Adds one file as CIDv1 and pins it; returns the CID. */
    async add(name, bytes) {
      const form = new FormData();
      form.append('file', new Blob([bytes]), name);
      const text = await (await rpc('add', { 'cid-version': '1', pin: 'true', quieter: 'true' }, form)).text();
      return JSON.parse(text.trim().split('\n').pop()).Hash;
    },
    async dagExport(cid) {
      return Buffer.from(await (await rpc('dag/export', { arg: cid })).arrayBuffer());
    },
  };
}
