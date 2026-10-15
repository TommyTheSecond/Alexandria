#!/usr/bin/env node
// Reads operators from AlexandriaFund and approved books from the host snapshot,
// then writes targets.json for scanner.nodecheck probe (D4-2).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { avalancheFuji } from 'viem/chains';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const fundAbi = parseAbi([
  'function stats() external view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256)',
  'function operatorList() external view returns (address[], string[])',
]);

export async function buildTargets({ fundDeploymentPath, snapshotPath, outPath, rpcUrls }) {
  if (!existsSync(fundDeploymentPath)) {
    console.log(`node-targets: ${fundDeploymentPath} does not exist; skipping`);
    return null;
  }

  const fundDeployment = JSON.parse(readFileSync(fundDeploymentPath, 'utf8'));
  const contract = fundDeployment.address;
  if (!contract) {
    console.log('node-targets: no contract address in fund deployment; skipping');
    return null;
  }

  const client = createPublicClient({
    chain: avalancheFuji,
    transport: fallback(rpcUrls.map((u) => http(u, { timeout: 8000 }))),
  });

  const [statsRes, [ops, gws]] = await Promise.all([
    client.readContract({ address: contract, abi: fundAbi, functionName: 'stats' }),
    client.readContract({ address: contract, abi: fundAbi, functionName: 'operatorList' }),
  ]);

  const epoch = Number(statsRes[3]);
  const operators = ops.map((address, i) => ({ address, gateway: gws[i] }));

  // Probes: read approved books from snapshot, or fallback to snapshot file
  let probes = [];
  if (existsSync(snapshotPath)) {
    try {
      const snapData = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      const approvedBooks = (snapData.books ?? []).filter(
        (b) => b.status === 'approved' && b.pdfCid && b.pdfSha256
      );
      if (approvedBooks.length > 0) {
        probes = approvedBooks.map((b) => ({
          cid: b.pdfCid,
          sha256: b.pdfSha256,
          kind: 'book',
          bookId: b.id,
        }));
      } else {
        const snapBytes = readFileSync(snapshotPath);
        const hash = '0x' + createHash('sha256').update(snapBytes).digest('hex');
        probes = [{ cid: snapData.cid ?? 'bafkreilatestsnapshot', sha256: hash, kind: 'snapshot' }];
      }
    } catch (e) {
      console.warn(`node-targets: error parsing snapshot: ${e.message}`);
    }
  }

  const targetsData = {
    epoch,
    generatedAt: new Date().toISOString(),
    operators,
    probes,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(targetsData, null, 2), 'utf8');
  console.log(`node-targets: wrote ${operators.length} operator(s) and ${probes.length} probe(s) to ${outPath}`);
  return targetsData;
}

async function main() {
  const fundDeploymentPath =
    process.env.FUND_DEPLOYMENT ?? resolve(ROOT, 'deployments/fuji-fund.json');
  const snapshotPath =
    process.env.SNAPSHOT_FILE ?? resolve(ROOT, 'snapshots/latest.json');
  const outPath =
    process.env.TARGETS_FILE ?? resolve(ROOT, 'infra/onion/run/nodecheck/targets.json');

  let rpcUrls = ['https://api.avax-test.network/ext/bc/C/rpc'];
  const rpcsPath = resolve(ROOT, 'infra/rpcs.json');
  if (existsSync(rpcsPath)) {
    try {
      const rpcs = JSON.parse(readFileSync(rpcsPath, 'utf8'));
      rpcUrls = rpcs.clearnet ?? rpcUrls;
    } catch {}
  }

  await buildTargets({ fundDeploymentPath, snapshotPath, outPath, rpcUrls });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`node-targets failed: ${err.message}`);
    process.exit(1);
  });
}
