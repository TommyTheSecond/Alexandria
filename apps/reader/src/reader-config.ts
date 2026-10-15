import type { ClientConfig } from '@alexandria/sdk';

interface RuntimeConfig { apiBase?: string; onion?: string }
interface Endpoints {
  rpcs: { clearnet: string[]; onion: string[] };
  gateways: { clearnet: string[]; onion: string[] };
  deployment: { address: string; deployBlock: number };
}

export function resolveReaderConfig(hostname: string, runtime: RuntimeConfig, endpoints: Endpoints) {
  const onion = hostname.endsWith('.onion');
  const apiBase = runtime.apiBase?.trim() || (onion ? '/api' : '');
  const client: ClientConfig = {
    rpcUrls: onion ? endpoints.rpcs.onion : endpoints.rpcs.clearnet,
    gateways: onion ? endpoints.gateways.onion : endpoints.gateways.clearnet,
    apiBase,
    contract: endpoints.deployment.address as ClientConfig['contract'],
    snapshotUrls: ['./catalog.json'],
    deployBlock: endpoints.deployment.deployBlock,
  };
  return { client, uploadEnabled: Boolean(apiBase), onionUrl: runtime.onion ? `http://${runtime.onion}/` : '' };
}
