#!/usr/bin/env node
// Checks if MIN_EPOCH_SECONDS has passed since lastEpochAt on AlexandriaFund.
// If so: runs scanner.nodecheck report, pins report.json (Kubo + Filebase),
// and signs closeEpoch(active, reportCid) with the host signer wallet (D4-2).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kuboClient } from './kubo.mjs';
import { filebaseConfig, uploadCar } from './filebase.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function loadDeps() {
  let viem, accounts, chains, ethers;
  try {
    viem = await import('viem');
    accounts = await import('viem/accounts');
    chains = await import('viem/chains');
    ethers = await import('ethers');
  } catch {
    const fromSdk = createRequire(join(ROOT, 'packages/sdk/package.json'));
    const fromRelayer = createRequire(join(ROOT, 'relayer/package.json'));
    const imp = (req, name) => import(pathToFileURL(req.resolve(name)).href);
    [viem, accounts, chains, ethers] = await Promise.all([
      imp(fromSdk, 'viem'),
      imp(fromSdk, 'viem/accounts'),
      imp(fromSdk, 'viem/chains'),
      imp(fromRelayer, 'ethers'),
    ]);
  }
  return {
    ...viem,
    ...accounts,
    ...chains,
    Wallet: ethers.Wallet || ethers.default?.Wallet || ethers,
  };
}

async function unlockHostSigner(Wallet) {
  // 1. Direct private key (e.g. Anvil / local tests / CI)
  if (process.env.HOST_SIGNER_KEY) {
    const raw = process.env.HOST_SIGNER_KEY.trim();
    return raw.startsWith('0x') ? raw : `0x${raw}`;
  }

  // 2. Encrypted keystore file
  const keystorePath =
    process.env.HOST_KEYSTORE ?? resolve(process.env.HOME || process.env.USERPROFILE || '', '.alexandria/host-signer.json');
  const passwordFile =
    process.env.HOST_PASSWORD_FILE ?? resolve(process.env.HOME || process.env.USERPROFILE || '', '.alexandria/host-signer.pwd');

  if (!existsSync(keystorePath)) {
    throw new Error(`Host signer keystore not found at ${keystorePath} and HOST_SIGNER_KEY not set`);
  }
  if (!existsSync(passwordFile)) {
    throw new Error(`Host signer password file not found at ${passwordFile}`);
  }

  const json = readFileSync(keystorePath, 'utf8');
  const password = readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '');
  const wallet = await Wallet.fromEncryptedJson(json, Buffer.from(password, 'utf8'));
  return wallet.privateKey;
}

export async function closeEpochJob({
  fundDeploymentPath,
  stateDir,
  reportPath,
  rpcUrls,
  skipTimeCheck = false,
}) {
  if (!existsSync(fundDeploymentPath)) {
    console.log(`close-epoch: ${fundDeploymentPath} does not exist; skipping`);
    return null;
  }

  const { createPublicClient, createWalletClient, fallback, http, parseAbi, privateKeyToAccount, avalancheFuji, Wallet } = await loadDeps();

  const fundAbi = parseAbi([
    'function stats() external view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256)',
    'function closeEpoch(address[] calldata active, string calldata reportCid) external',
  ]);

  const fundDeployment = JSON.parse(readFileSync(fundDeploymentPath, 'utf8'));
  const contract = fundDeployment.address;
  if (!contract) {
    console.log('close-epoch: no contract address in fund deployment; skipping');
    return null;
  }

  const pubClient = createPublicClient({
    chain: avalancheFuji,
    transport: fallback(rpcUrls.map((u) => http(u, { timeout: 8000 }))),
  });

  const statsRes = await pubClient.readContract({
    address: contract,
    abi: fundAbi,
    functionName: 'stats',
  });

  const epoch = Number(statsRes[3]);
  const lastEpochAt = Number(statsRes[4]);
  const minEpochSeconds = fundDeployment.minEpochSeconds ?? 600;
  const now = Math.floor(Date.now() / 1000);

  if (!skipTimeCheck && now < lastEpochAt + minEpochSeconds) {
    const remaining = lastEpochAt + minEpochSeconds - now;
    console.log(`close-epoch: epoch interval not elapsed yet (${remaining}s remaining); skipping`);
    return null;
  }

  console.log(`close-epoch: generating report for epoch ${epoch}…`);
  // Run python report generator
  execFileSync(
    'python',
    [
      '-m',
      'scanner.nodecheck',
      'report',
      '--state',
      stateDir,
      '--epoch',
      String(epoch),
      '--out',
      reportPath,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );

  if (!existsSync(reportPath)) {
    throw new Error(`report file ${reportPath} was not generated`);
  }

  const reportBytes = readFileSync(reportPath);
  const reportData = JSON.parse(reportBytes.toString('utf8'));

  // Pin report via Kubo
  let reportCid;
  try {
    const kubo = kuboClient();
    reportCid = await kubo.add('report.json', reportBytes);
    console.log(`close-epoch: report pinned on Kubo with CID ${reportCid}`);

    try {
      const cfg = filebaseConfig(process.env);
      await uploadCar(cfg, `reports/${reportCid}.car`, await kubo.dagExport(reportCid));
      console.log(`close-epoch: report CAR uploaded to Filebase`);
    } catch (e) {
      console.log(`close-epoch: Filebase upload skipped: ${e.message}`);
    }
  } catch (err) {
    throw new Error(`close-epoch: Kubo pinning failed (${err.message}); aborting epoch close`);
  }

  // Sign closeEpoch on-chain
  const privateKey = await unlockHostSigner(Wallet);
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: fallback(rpcUrls.map((u) => http(u, { timeout: 8000 }))),
  });

  console.log(`close-epoch: sending closeEpoch transaction with ${reportData.active.length} active node(s)…`);
  const txHash = await walletClient.writeContract({
    address: contract,
    abi: fundAbi,
    functionName: 'closeEpoch',
    args: [reportData.active, reportCid],
  });

  const receipt = await pubClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`closeEpoch transaction reverted: ${txHash}`);
  }

  console.log(`close-epoch: successfully closed epoch ${epoch}! tx: ${txHash}`);
  return { txHash, epoch, active: reportData.active, reportCid };
}

async function main() {
  const fundDeploymentPath =
    process.env.FUND_DEPLOYMENT ?? resolve(ROOT, 'deployments/fuji-fund.json');
  const stateDir =
    process.env.NODECHECK_STATE ?? resolve(ROOT, 'infra/onion/run/nodecheck');
  const reportPath =
    process.env.REPORT_FILE ?? resolve(ROOT, 'infra/onion/run/nodecheck/report.json');

  let rpcUrls = ['https://api.avax-test.network/ext/bc/C/rpc'];
  const rpcsPath = resolve(ROOT, 'infra/rpcs.json');
  if (existsSync(rpcsPath)) {
    try {
      const rpcs = JSON.parse(readFileSync(rpcsPath, 'utf8'));
      rpcUrls = rpcs.clearnet ?? rpcUrls;
    } catch {}
  }

  await closeEpochJob({ fundDeploymentPath, stateDir, reportPath, rpcUrls });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`close-epoch failed: ${err.message}`);
    process.exit(1);
  });
}
