#!/usr/bin/env node
// Prints Filebase bucket usage against the 5 GB free tier (A6 T5). Warns above 1 GB.
//   node --env-file=infra/.env infra/scripts/filebase-usage.mjs
import { bucketUsage, filebaseConfig, usageSummary } from './filebase.mjs';

const cfg = filebaseConfig(process.env);
const { bytes, objects } = await bucketUsage(cfg);
const s = usageSummary(bytes);
console.log(`filebase  ${cfg.bucket}: ${objects} objects, ${s.text}`);
if (s.level === 'warn') console.log('WARN      over 1 GB: README 14 says keep the corpus under 1 GB');
if (s.level === 'full') console.log('FULL      free tier used up: uploads will fail');
process.exit(s.level === 'ok' ? 0 : 1);
