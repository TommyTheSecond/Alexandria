import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const deployment = JSON.parse(readFileSync(resolve(ROOT, 'deployments/fuji.json'), 'utf8'));
const rpcs = JSON.parse(readFileSync(resolve(ROOT, 'infra/rpcs.json'), 'utf8'));
const rpc = process.env.RPC_URL || rpcs.clearnet[0];

const account = process.env.CURATOR_ACCOUNT || 'curator';
const target = deployment.address;

console.log(`Target Contract: ${target}`);
console.log(`Curator Account: ${account}`);
console.log(`RPC: ${rpc}`);

// 1-11 Reject
// 12-21 Approve
const reviews = [
  ...Array.from({ length: 11 }, (_, i) => ({
    id: i + 1,
    approve: false,
    reason: 'Unvetted translation and scanner match discrepancies in Batch 1 seed'
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: i + 12,
    approve: true,
    reason: 'Public domain verified and compressed text layer confirmed (Batch 2)'
  }))
];

async function main() {
  for (const item of reviews) {
    console.log(`\nReviewing Book #${item.id} -> ${item.approve ? 'APPROVE' : 'REJECT'}...`);
    const args = [
      'send',
      target,
      'review(uint256,bool,string)',
      String(item.id),
      item.approve ? 'true' : 'false',
      item.reason,
      '--account', account,
      '--rpc-url', rpc
    ];
    if (process.env.PASSWORD_FILE) {
      args.push('--password-file', process.env.PASSWORD_FILE);
    }
    const res = spawnSync('cast', args, { encoding: 'utf8', stdio: 'inherit' });
    if (res.status !== 0) {
      console.error(`Failed reviewing Book #${item.id}`);
      process.exit(1);
    }
  }
  console.log('\nAll 21 reviews completed successfully!');
}

main().catch(console.error);
