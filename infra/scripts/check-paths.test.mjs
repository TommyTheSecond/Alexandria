import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPaths } from './check-paths.mjs';

const ok = (branch, files) => assert.equal(checkPaths(branch, files).ok, true, `${branch} should allow ${files}`);
const denied = (branch, files) => assert.equal(checkPaths(branch, files).ok, false, `${branch} should deny ${files}`);

test('a1 owns contracts except tests and the frozen interface', () => {
  ok('ws1/a1/registry', ['contracts/src/Alexandria.sol', 'contracts/foundry.toml', 'deployments/fuji.json']);
  denied('ws1/a1/registry', ['contracts/test/Alexandria.t.sol']);
  denied('ws1/a1/registry', ['contracts/src/IAlexandria.sol']);
});

test('a2 owns contract tests and the relayer', () => {
  ok('ws1/a2/tests', ['contracts/test/Alexandria.t.sol', 'relayer/src/index.ts']);
  denied('ws1/a2/tests', ['contracts/src/Alexandria.sol']);
});

test('a3 owns scanner, ingest and fixtures', () => {
  ok('ws2/a3/fixtures', ['scanner/app.py', 'ingest/match_pg.py', 'fixtures/catalog.json']);
  denied('ws2/a3/fixtures', ['schemas/book.schema.json']);
});

test('a4 owns the reader app', () => {
  ok('ws3/a4/theme', ['apps/reader/src/main.tsx']);
  denied('ws3/a4/theme', ['packages/sdk/src/client.ts']);
});

test('a5 owns the sdk except types.ts, plus snapshots', () => {
  ok('ws3/a5/download-verify', ['packages/sdk/src/client.ts', 'snapshots/latest.json']);
  denied('ws3/a5/download-verify', ['packages/sdk/src/types.ts']);
});

test('a6 owns infra, assets, .github, root config and the reachability doc', () => {
  ok('ws4/a6/scaffold', ['infra/onion/Caddyfile', 'assets/art/hero-100.txt', '.github/workflows/ci.yml', 'package.json', '.gitignore', 'docs/reachability.md', 'apps/.gitkeep']);
  denied('ws4/a6/scaffold', ['README.md']);
});

test('every agent may change pnpm-lock.yaml', () => {
  ok('ws3/a4/deps', ['apps/reader/package.json', 'pnpm-lock.yaml']);
});

test('workstream number must match the agent', () => {
  denied('ws2/a1/registry', ['contracts/src/Alexandria.sol']);
});

test('rfc branches touch only frozen interface files', () => {
  ok('rfc/g0-interfaces', ['contracts/src/IAlexandria.sol', 'schemas/book.schema.json', 'packages/sdk/src/types.ts', 'docs/INTERFACES.md']);
  denied('rfc/g0-interfaces', ['contracts/src/Alexandria.sol']);
});

test('docs branches touch only the plan files', () => {
  ok('docs/kickoff', ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/agents/A6-access-ops.md']);
  denied('docs/kickoff', ['infra/onion/Caddyfile']);
});

test('unknown branch names are denied', () => {
  denied('feature/thing', ['README.md']);
});

test('reports each file outside the owned paths', () => {
  const r = checkPaths('ws3/a4/theme', ['apps/reader/a.ts', 'infra/x.json', 'scanner/y.py']);
  assert.deepEqual(r.violations, ['infra/x.json', 'scanner/y.py']);
});
