#!/usr/bin/env node
// Reachability report from OONI data (A6 T6). Writes docs/reachability.md.
//   node infra/ooni/report.mjs                    last 30 days up to today (UTC)
//   node infra/ooni/report.mjs --until 2026-10-15 reproducible window
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.ooni.io/api/v1/aggregation';
const COUNTRIES = { CN: 'China', IR: 'Iran', RU: 'Russia', US: 'United States' };
// README D2 / A6 brief; the RPC and gateway hosts are added from infra/*.json.
const BRIEF_DOMAINS = ['ipfs.io', 'dweb.link', 'ipfs.filebase.io', 'api.avax-test.network', 'github.io', 'torproject.org'];
const TOR = 'tor (OONI tor test)';
const HIGH_RATE = 50; // % anomalies worth calling out
const MIN_SAMPLE = 20; // fewer measurements than this are too few to call

export function aggregationUrl({ cc, test, domain, since, until }) {
  const u = new URL(API);
  u.searchParams.set('probe_cc', cc);
  u.searchParams.set('test_name', test);
  if (domain) u.searchParams.set('domain', domain);
  u.searchParams.set('since', since);
  u.searchParams.set('until', until);
  return u.toString();
}

export function anomalyRate({ anomaly_count, measurement_count }) {
  if (!measurement_count) return 'unknown';
  return ((anomaly_count / measurement_count) * 100).toFixed(1);
}

export function domainsFrom(rpcs, gateways, extra = BRIEF_DOMAINS) {
  const hosts = [...rpcs.clearnet, ...gateways.clearnet, ...(gateways.onion ?? [])]
    .filter((u) => u.startsWith('https://'))
    .map((u) => new URL(u).hostname);
  return [...new Set([...extra, ...hosts])];
}

export function renderMarkdown({ since, until, generatedAt, countries, rows }) {
  const out = [
    '# Reachability report',
    '',
    `OONI measurements from **${since} to ${until}** (UTC), generated ${generatedAt} by \`infra/ooni/report.mjs\`.`,
    'Re-run it with `--until <date>` to reproduce these numbers.',
    '',
    '**How to read this:**',
    '',
    '- Source: the OONI aggregation API, `web_connectivity` test per domain, plus the `tor` test per country.',
    '- An OONI **anomaly is not the same as a confirmed block**. It means the measurement looked unlike a normal',
    '  connection (DNS, TCP, TLS or HTTP differed). Confirmed blocks are the cases OONI matched to a known block page.',
    '- OONI probes are run by **volunteers**, so sample sizes differ a lot between countries and domains.',
    '- Zero measurements means **unknown**, not reachable.',
    '- anomaly rate (%) = anomalies ÷ measurements × 100.',
    '',
    '## Key findings',
    '',
    `Generated from the tables below: anomaly rate ≥ ${HIGH_RATE}% with at least ${MIN_SAMPLE} measurements, and targets with no data.`,
    '',
  ];
  for (const cc of countries) {
    const mine = rows.filter((x) => x.cc === cc);
    for (const { target, r } of mine) {
      if (r.measurement_count >= MIN_SAMPLE && Number(anomalyRate(r)) >= HIGH_RATE) {
        out.push(`- ${cc}: high anomaly rate for ${target} (${anomalyRate(r)}% of ${r.measurement_count})`);
      }
    }
    const none = mine.filter(({ r }) => !r.measurement_count).map(({ target }) => target);
    if (none.length) out.push(`- ${cc}: no data for ${none.join(', ')}`);
  }
  out.push('');
  for (const cc of countries) {
    out.push(`## ${COUNTRIES[cc] ?? cc} (${cc})`, '');
    out.push('| domain | measurements | anomalies | confirmed blocks | anomaly rate (%) |');
    out.push('|---|---:|---:|---:|---:|');
    for (const { target, r } of rows.filter((x) => x.cc === cc)) {
      out.push(`| ${target} | ${r.measurement_count} | ${r.anomaly_count} | ${r.confirmed_count} | ${anomalyRate(r)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

async function fetchCounts(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).result;
    } catch (e) {
      if (i >= attempts) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--until');
  const until = i >= 0 ? args[i + 1] : new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(until) - 30 * 86_400_000).toISOString().slice(0, 10);

  const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const domains = domainsFrom(read('rpcs.json'), read('gateways.json'));
  const countries = Object.keys(COUNTRIES);

  const jobs = countries.flatMap((cc) => [
    ...domains.map((domain) => ({ cc, target: domain, url: aggregationUrl({ cc, test: 'web_connectivity', domain, since, until }) })),
    { cc, target: TOR, url: aggregationUrl({ cc, test: 'tor', since, until }) },
  ]);

  const rows = [];
  for (let k = 0; k < jobs.length; k += 4) {
    const batch = jobs.slice(k, k + 4);
    const results = await Promise.all(batch.map((j) => fetchCounts(j.url)));
    batch.forEach((j, n) => rows.push({ cc: j.cc, target: j.target, r: results[n] }));
    process.stdout.write(`\r${rows.length}/${jobs.length} queries`);
  }
  process.stdout.write('\n');

  const md = renderMarkdown({ since, until, generatedAt: new Date().toISOString().slice(0, 16) + 'Z', countries, rows });
  const out = new URL('../../docs/reachability.md', import.meta.url);
  writeFileSync(out, md);
  console.log(`wrote docs/reachability.md (${since} to ${until})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
