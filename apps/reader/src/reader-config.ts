import type { ClientConfig } from '@alexandria/sdk';

// Toggle temporary re-upload support for the testing phase:
// Set ALLOW_REUPLOADS = false to disable later on, or override at runtime with
// ?reuploads=0 in the URL, {"allowReuploads": false} in config.json, or VITE_ALLOW_REUPLOADS=false.
export const ALLOW_REUPLOADS = true;

interface RuntimeConfig { apiBase?: string; onion?: string; allowReuploads?: boolean }
interface Endpoints {
  rpcs: { clearnet: string[]; onion: string[] };
  gateways: { clearnet: string[]; onion: string[] };
  deployment: { address: string; deployBlock: number };
}

export function isReuploadAllowed(search = '', runtimeAllow?: boolean, envAllow?: string): boolean {
  const param = new URLSearchParams(search).get('reuploads');
  if (param === '0' || param === 'false') return false;
  if (param === '1' || param === 'true') return true;
  if (typeof runtimeAllow === 'boolean') return runtimeAllow;
  if (envAllow === 'false' || envAllow === '0') return false;
  if (envAllow === 'true' || envAllow === '1') return true;
  return ALLOW_REUPLOADS;
}

export function buildReuploadPdf(file: File, stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): File {
  const trailer = `\n% alexandria-reupload-${stamp}\n%%EOF\n`;
  return new File([file, trailer], file.name, { type: file.type || 'application/pdf' });
}

export function resolveReaderConfig(hostname: string, runtime: RuntimeConfig, endpoints: Endpoints) {
  const onion = hostname.endsWith('.onion');
  const apiBase = onion ? '/api' : (runtime.apiBase?.trim() ?? '');
  const client: ClientConfig = {
    rpcUrls: onion ? endpoints.rpcs.onion : endpoints.rpcs.clearnet,
    gateways: onion ? endpoints.gateways.onion : endpoints.gateways.clearnet,
    apiBase,
    contract: endpoints.deployment.address as ClientConfig['contract'],
    snapshotUrls: ['./catalog.json'],
    deployBlock: endpoints.deployment.deployBlock,
  };
  return {
    client,
    uploadEnabled: Boolean(apiBase),
    onionUrl: runtime.onion ? `http://${runtime.onion}/` : '',
    allowReuploads: runtime.allowReuploads,
  };
}

export function sortPendingByScore<T extends { id: number }>(books: T[], scores: Record<number, number>) {
  return [...books].sort((a, b) => (scores[a.id] ?? Infinity) - (scores[b.id] ?? Infinity) || a.id - b.id);
}

