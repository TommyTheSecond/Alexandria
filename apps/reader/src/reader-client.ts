import { createClient } from '@alexandria/sdk';
import deployment from '../../../deployments/fuji.json';
import gateways from '../../../infra/gateways.json';
import rpcs from '../../../infra/rpcs.json';
import committed from '../../../infra/config/config.json';
import { resolveReaderConfig } from './reader-config';

export async function connectReader() {
  let runtime = committed;
  try {
    const response = await fetch('./config.json');
    if (response.ok) runtime = { ...committed, ...await response.json() };
  } catch { /* The committed configuration still supports read-only access. */ }
  const resolved = resolveReaderConfig(location.hostname, runtime, { deployment, gateways, rpcs });
  return {
    client: createClient(resolved.client),
    uploadEnabled: resolved.uploadEnabled,
    onionUrl: resolved.onionUrl,
    reportGateway: resolved.client.gateways[0] ?? '',
    allowReuploads: resolved.allowReuploads,
  };
}

