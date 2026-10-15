import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function cast(args, interactive = false) {
  const result = spawnSync('cast', args, { encoding: 'utf8', stdio: interactive ? 'inherit' : 'pipe' });
  if (result.status !== 0) throw new Error('Cast command failed; check network, wallet and permissions.');
  return result.stdout?.trim() ?? '';
}

try {
  const args = process.argv.slice(2);
  let account = process.env.CURATOR_ACCOUNT || 'curator';
  if (args[0] === '--account') { args.shift(); account = args.shift(); }
  const command = args.shift();
  if (!account || !['pending', 'approve', 'reject', 'snapshot'].includes(command)) {
    throw new Error('Usage: curate.sh [--account name] pending|approve id reason|reject id reason|snapshot cid block');
  }
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error('RPC_URL is required');
  const chainId = Number(cast(['chain-id', '--rpc-url', rpc]));
  if (chainId !== 43113 && chainId !== 31337) throw new Error('Fuji or Anvil only');
  const path = resolve(process.env.DEPLOYMENT || `../deployments/${chainId === 43113 ? 'fuji' : 'anvil'}.json`);
  const deployment = JSON.parse(readFileSync(path, 'utf8'));
  if (deployment.chainId !== chainId || !/^0x[0-9a-fA-F]{40}$/.test(deployment.address)) {
    throw new Error('Deployment record and RPC network do not match');
  }
  const common = ['--rpc-url', rpc];
  const target = deployment.address;
  if (command === 'pending') {
    const count = Number(cast(['call', target, 'bookCount()(uint256)', ...common]).split(' ')[0]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid book count');
    for (let id = 1; id <= count; ++id) {
      // cast's tuple text is not parsed: ABI encoding gives a fixed status word after the dynamic offset.
      const selector = cast(['calldata', 'getBook(uint256)', String(id)]);
      const encoded = JSON.parse(cast(['rpc', 'eth_call', JSON.stringify({ to: target, data: selector }), 'latest', ...common]));
      if (typeof encoded !== 'string' || !/^0x[0-9a-f]+$/i.test(encoded)) throw new Error('Invalid book response');
      const bytes = encoded.slice(2);
      const offset = Number(BigInt(`0x${bytes.slice(0, 64)}`)) * 2;
      const status = Number(BigInt(`0x${bytes.slice(offset + 5 * 64, offset + 6 * 64)}`));
      if (status === 1) console.log(id);
    }
  } else {
    let call;
    if (command === 'snapshot') {
      const [cid, block] = args;
      if (!/^baf[a-z2-7]{20,97}$/.test(cid ?? '') || !/^\d+$/.test(block ?? '')) throw new Error('Expected CIDv1 and block number');
      call = ['publishSnapshot(string,uint256)', cid, block];
    } else {
      const [id, ...reason] = args;
      if (!/^[1-9]\d*$/.test(id ?? '') || reason.length === 0) throw new Error('Expected book ID and reason');
      call = ['review(uint256,bool,string)', id, command === 'approve' ? 'true' : 'false', reason.join(' ')];
    }
    cast(['send', target, ...call, '--account', account, ...common], true);
  }
} catch (error) {
  // Only our fixed messages are printed, never command arguments or provider diagnostics.
  console.error(error instanceof Error && !error.message.includes('ENOENT') ? error.message : 'Cannot read deployment or run cast.');
  process.exitCode = 1;
}
