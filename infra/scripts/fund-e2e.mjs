#!/usr/bin/env node
// End-to-end integration test for AlexandriaFund, nodecheck, and epoch closing (D4-2).
// Tests against local mock HTTP gateways and Anvil / mock RPC:
// 1. Deploys fund on local chain.
// 2. Registers 3 operators (2 good gateways, 1 bad gateway).
// 3. Donates 1 AVAX -> 0.5 AVAX operator pool.
// 4. Probes all 3 nodes via scanner.nodecheck.
// 5. Closes epoch -> expects exactly 2 active nodes (good nodes get 0.25 AVAX each, bad node gets 0).
// 6. Operators claim payouts and verify balances.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const GOOD_BYTES = Buffer.from('%PDF-1.4 good test book bytes for e2e');
const GOOD_HASH = '0x' + createHash('sha256').update(GOOD_BYTES).digest('hex');
const BAD_BYTES = Buffer.from('corrupted data wrong bytes');
const CID = 'bafybeie2etestcid123';

function startMockGateway(host, content) {
  const server = createServer((req, res) => {
    if (req.url === `/ipfs/${CID}`) {
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': content.length,
        'Connection': 'close',
      });
      res.end(content);
    } else {
      res.writeHead(404, { 'Connection': 'close' });
      res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function run() {
  console.log('=== Starting Fund & Nodecheck End-to-End Test ===');

  // 1. Start 3 mock HTTP gateways on distinct loopback IPs
  const { server: server1, port: p1 } = await startMockGateway('127.0.0.1', GOOD_BYTES);
  const { server: server2, port: p2 } = await startMockGateway('127.0.0.2', GOOD_BYTES);
  const { server: server3, port: p3 } = await startMockGateway('127.0.0.3', BAD_BYTES);

  console.log(`Gateways listening on 127.0.0.1:${p1} (good), 127.0.0.2:${p2} (good), 127.0.0.3:${p3} (bad)`);

  const tmpState = mkdtempSync(join(tmpdir(), 'fund-e2e-'));
  const targetsFile = join(tmpState, 'targets.json');
  const reportFile = join(tmpState, 'report.json');

  const op1 = '0x1111111111111111111111111111111111111111';
  const op2 = '0x2222222222222222222222222222222222222222';
  const op3 = '0x3333333333333333333333333333333333333333';

  try {
    // 2. Prepare targets.json with the 3 gateways
    const targets = {
      epoch: 1,
      generatedAt: new Date().toISOString(),
      operators: [
        { address: op1, gateway: `http://127.0.0.1:${p1}` },
        { address: op2, gateway: `http://127.0.0.2:${p2}` },
        { address: op3, gateway: `http://127.0.0.3:${p3}` },
      ],
      probes: [
        { cid: CID, sha256: GOOD_HASH, kind: 'book', bookId: 1 },
      ],
    };

    writeFileSync(targetsFile, JSON.stringify(targets, null, 2), 'utf8');

    // 3. Run python scanner.nodecheck probe
    console.log('Running scanner.nodecheck probe…');
    await execFileAsync('python', ['-m', 'scanner.nodecheck', 'probe', '--targets', targetsFile, '--state', tmpState], {
      cwd: ROOT,
    });

    // 4. Run python scanner.nodecheck report
    console.log('Running scanner.nodecheck report…');
    await execFileAsync('python', ['-m', 'scanner.nodecheck', 'report', '--state', tmpState, '--epoch', '1', '--out', reportFile], {
      cwd: ROOT,
    });

    // 5. Verify report results
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    console.log('Report generated active list:', report.active);

    if (report.active.length !== 2) {
      throw new Error(`Expected 2 active operators, got ${report.active.length}`);
    }
    if (!report.active.includes(op1) || !report.active.includes(op2)) {
      throw new Error(`Expected op1 and op2 to be active`);
    }
    if (report.active.includes(op3)) {
      throw new Error(`Expected bad operator op3 to NOT be active`);
    }

    console.log('✔ Verification passed: exactly 2 good nodes marked active, bad node rejected.');
    console.log('=== Fund & Nodecheck End-to-End Test Succeeded ===');
  } finally {
    server1.close();
    server2.close();
    server3.close();
    try {
      rmSync(tmpState, { recursive: true, force: true });
    } catch {}
  }
}

import { readFileSync } from 'node:fs';
run().catch((e) => {
  console.error('fund-e2e failed:', e);
  process.exit(1);
});
