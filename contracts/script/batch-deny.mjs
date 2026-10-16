import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const deployment = JSON.parse(readFileSync(resolve(ROOT, 'deployments/fuji.json'), 'utf8'));
const abi = JSON.parse(readFileSync(resolve(ROOT, 'deployments/abi/IAlexandria.json'), 'utf8'));
const rpcs = JSON.parse(readFileSync(resolve(ROOT, 'infra/rpcs.json'), 'utf8'));

const PK = process.env.CURATOR_KEY;
if (!PK) {
  console.error('Error: CURATOR_KEY environment variable is required (hex private key with CURATOR_ROLE).');
  console.error('Example: $env:CURATOR_KEY="0x..."; node contracts/script/batch-deny.mjs');
  process.exit(1);
}

const account = privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`);
const rpcUrl = process.env.RPC_URL || rpcs.clearnet[0];

console.log('Target Contract:', deployment.address);
console.log('Curator Account:', account.address);
console.log('RPC Endpoint:   ', rpcUrl);

const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) });

async function main() {
  const count = await publicClient.readContract({
    address: deployment.address,
    abi,
    functionName: 'bookCount',
  });
  console.log(`\nTotal registered books: ${count}`);

  const pendingIds = [];
  for (let id = 1n; id <= count; id++) {
    const book = await publicClient.readContract({
      address: deployment.address,
      abi,
      functionName: 'getBook',
      args: [id],
    });
    // Status enum: 0=None, 1=Pending, 2=Approved, 3=Rejected, 4=Flagged
    if (book.status === 1) {
      pendingIds.push(id);
    }
  }

  console.log(`Found ${pendingIds.length} pending submissions to reject:`, pendingIds.map(Number));

  if (pendingIds.length === 0) {
    console.log('No pending submissions found. Nothing to deny.');
    return;
  }

  const reason = process.env.REJECT_REASON || 'Batch rejection of unvetted pending submissions';

  for (let i = 0; i < pendingIds.length; i++) {
    const id = pendingIds[i];
    process.stdout.write(`[${i + 1}/${pendingIds.length}] Rejecting Book #${id}... `);
    try {
      const hash = await walletClient.writeContract({
        address: deployment.address,
        abi,
        functionName: 'review',
        args: [id, false, reason],
      });
      console.log(`tx: ${hash.slice(0, 10)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
    }
  }

  console.log('\nAll pending rejections completed.');

  // Automatically purge Filebase of rejected/unwanted objects
  try {
    const { cleanupFilebase } = await import('./filebase-cleanup.mjs');
    console.log('\nReconciling and cleaning Filebase storage...');
    await cleanupFilebase();
  } catch (err) {
    console.warn(`Filebase cleanup notice: ${err.message}`);
  }
}

main().catch(console.error);
