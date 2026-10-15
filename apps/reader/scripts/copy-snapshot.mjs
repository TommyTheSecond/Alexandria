import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const snapshot = fileURLToPath(new URL('../../../snapshots/latest.json', import.meta.url));
const builtCatalog = fileURLToPath(new URL('../dist/catalog.json', import.meta.url));
if (existsSync(snapshot)) copyFileSync(snapshot, builtCatalog);
