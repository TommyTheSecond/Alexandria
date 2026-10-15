/// <reference types="vite/client" />
// The bounty contract's deployment record (I9). A literal import.meta.glob so Vite inlines it at build time;
// when deployments/fuji-bounties.json doesn't exist the result is empty and the reader works as before.
import type { BountyDeployment } from './BountiesPage';

const records = import.meta.glob<{ address?: unknown; deployBlock?: unknown }>(
  '../../../deployments/fuji-bounties.json', { eager: true, import: 'default' },
);
const record = Object.values(records)[0];

export const bountyDeployment: BountyDeployment | null =
  record && typeof record.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(record.address)
    ? { address: record.address as `0x${string}`, deployBlock: typeof record.deployBlock === 'number' ? record.deployBlock : 0 }
    : null;
