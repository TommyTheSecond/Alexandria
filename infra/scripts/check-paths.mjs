#!/usr/bin/env node
// Fails a PR that changes files outside the paths its branch owns (README section 4).
// Usage in CI: node infra/scripts/check-paths.mjs  (reads GITHUB_HEAD_REF and GITHUB_BASE_REF)
// Locally:     node infra/scripts/check-paths.mjs <branch> [base]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A path ending in "/" matches everything below it; anything else matches exactly.
const FROZEN = ['contracts/src/IAlexandria.sol', 'schemas/', 'packages/sdk/src/types.ts', 'docs/INTERFACES.md'];

const AGENTS = {
  a1: { ws: 1, own: ['contracts/', 'deployments/'], except: ['contracts/test/'] },
  a2: { ws: 1, own: ['contracts/test/', 'relayer/'] },
  a3: { ws: 2, own: ['scanner/', 'ingest/', 'fixtures/'] },
  a4: { ws: 3, own: ['apps/reader/'] },
  a5: { ws: 3, own: ['packages/sdk/', 'snapshots/'] },
  a6: {
    ws: 4,
    own: ['infra/', 'assets/', '.github/', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      '.gitignore', '.editorconfig', 'docs/reachability.md'],
    // The scaffold creates empty owner folders.
    anyFileNamed: ['.gitkeep'],
  },
};

const SHARED = ['pnpm-lock.yaml'];
const PLAN = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/agents/'];

const matches = (file, patterns) => patterns.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

function rulesFor(branch) {
  const ws = /^ws(\d)\/(a[1-6])\/[^/]+/.exec(branch);
  if (ws) {
    const agent = AGENTS[ws[2]];
    if (agent.ws !== Number(ws[1])) {
      return { error: `${ws[2]} belongs to ws${agent.ws}, not ws${ws[1]}` };
    }
    return {
      allow: (f) =>
        matches(f, SHARED) ||
        (agent.anyFileNamed ?? []).some((n) => f === n || f.endsWith(`/${n}`)) ||
        (matches(f, agent.own) && !matches(f, agent.except ?? []) && !matches(f, FROZEN)),
    };
  }
  if (/^rfc\/[^/]+/.test(branch)) return { allow: (f) => matches(f, FROZEN) };
  if (/^docs\/[^/]+/.test(branch)) return { allow: (f) => matches(f, PLAN) };
  return { error: `branch "${branch}" must be ws<n>/<agent>/<task>, rfc/<name> or docs/<name>` };
}

export function checkPaths(branch, files) {
  const rules = rulesFor(branch);
  if (rules.error) return { ok: false, reason: rules.error, violations: files };
  const violations = files.filter((f) => !rules.allow(f));
  return { ok: violations.length === 0, reason: violations.length ? 'files outside owned paths' : '', violations };
}

function main() {
  const branch = process.argv[2] ?? process.env.GITHUB_HEAD_REF;
  const base = process.argv[3] ?? process.env.GITHUB_BASE_REF ?? 'main';
  if (!branch) {
    console.log('check-paths: not a pull request, skipping');
    return;
  }
  const out = execFileSync('git', ['diff', '--name-only', `origin/${base}...HEAD`], { encoding: 'utf8' });
  const files = out.split('\n').filter(Boolean);
  const r = checkPaths(branch, files);
  if (r.ok) {
    console.log(`check-paths: ${branch} changes ${files.length} file(s), all owned`);
    return;
  }
  console.error(`check-paths: ${r.reason}`);
  for (const f of r.violations) console.error(`  not owned by ${branch}: ${f}`);
  console.error('Need a change there? Open an issue for the owner (README 4.1).');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
