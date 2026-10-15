import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregationUrl, anomalyRate, domainsFrom, renderMarkdown } from './report.mjs';

test('aggregation URL asks for one country, test and domain over the window', () => {
  const u = new URL(aggregationUrl({ cc: 'IR', test: 'web_connectivity', domain: 'ipfs.io', since: '2026-09-15', until: '2026-10-15' }));
  assert.equal(u.origin + u.pathname, 'https://api.ooni.io/api/v1/aggregation');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    probe_cc: 'IR', test_name: 'web_connectivity', domain: 'ipfs.io', since: '2026-09-15', until: '2026-10-15',
  });
});

test('the tor test has no domain parameter', () => {
  const u = new URL(aggregationUrl({ cc: 'CN', test: 'tor', since: '2026-09-15', until: '2026-10-15' }));
  assert.equal(u.searchParams.has('domain'), false);
});

test('anomaly rate is anomalies / measurements x 100, one decimal', () => {
  assert.equal(anomalyRate({ anomaly_count: 43, measurement_count: 48 }), '89.6');
});

test('zero measurements is unknown, not reachable', () => {
  assert.equal(anomalyRate({ anomaly_count: 0, measurement_count: 0 }), 'unknown');
});

test('domains: the brief list plus every https host in the RPC and gateway lists, deduplicated', () => {
  const d = domainsFrom(
    { clearnet: ['https://api.avax-test.network/ext/bc/C/rpc', 'https://avalanche-fuji.drpc.org'] },
    { clearnet: ['https://ipfs.filebase.io', 'https://storry.tv'], onion: ['', 'https://storry.tv'] },
    ['ipfs.io', 'api.avax-test.network'],
  );
  assert.deepEqual(d, ['ipfs.io', 'api.avax-test.network', 'avalanche-fuji.drpc.org', 'ipfs.filebase.io', 'storry.tv']);
});

test('markdown has one table per country with the required columns and caveats', () => {
  const md = renderMarkdown({
    since: '2026-09-15',
    until: '2026-10-15',
    generatedAt: '2026-10-15T07:00:00Z',
    countries: ['CN', 'US'],
    rows: [
      { cc: 'CN', target: 'ipfs.io', r: { measurement_count: 48, anomaly_count: 43, confirmed_count: 0 } },
      { cc: 'CN', target: 'tor (OONI tor test)', r: { measurement_count: 0, anomaly_count: 0, confirmed_count: 0 } },
      { cc: 'US', target: 'ipfs.io', r: { measurement_count: 10, anomaly_count: 0, confirmed_count: 0 } },
    ],
  });
  assert.match(md, /2026-09-15 to 2026-10-15/);
  assert.match(md, /## China \(CN\)/);
  assert.match(md, /## United States \(US\)/);
  assert.match(md, /\| domain \| measurements \| anomalies \| confirmed blocks \| anomaly rate \(%\) \|/);
  assert.match(md, /\| ipfs\.io \| 48 \| 43 \| 0 \| 89\.6 \|/);
  assert.match(md, /\| tor \(OONI tor test\) \| 0 \| 0 \| 0 \| unknown \|/);
  assert.match(md, /not the same as a confirmed block/i);
  assert.match(md, /volunteer/i);
  assert.match(md, /zero measurements means \*\*unknown\*\*/i);
});

test('key findings flag high anomaly rates only when the sample is big enough', () => {
  const md = renderMarkdown({
    since: '2026-09-15', until: '2026-10-15', generatedAt: 'x', countries: ['CN'],
    rows: [
      { cc: 'CN', target: 'tor (OONI tor test)', r: { measurement_count: 312, anomaly_count: 302, confirmed_count: 0 } },
      { cc: 'CN', target: 'torproject.org', r: { measurement_count: 5, anomaly_count: 4, confirmed_count: 0 } },
      { cc: 'CN', target: 'storry.tv', r: { measurement_count: 0, anomaly_count: 0, confirmed_count: 0 } },
    ],
  });
  const findings = md.slice(md.indexOf('## Key findings'), md.indexOf('## China'));
  assert.match(findings, /CN: high anomaly rate for tor \(OONI tor test\) \(96\.8% of 312\)/);
  assert.doesNotMatch(findings, /torproject\.org \(/);
  assert.match(findings, /CN: no data for storry\.tv/);
});
