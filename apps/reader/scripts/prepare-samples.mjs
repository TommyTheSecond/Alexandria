import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../public/samples/', import.meta.url);
await mkdir(root, { recursive: true });
const samples = [
  { id: 1, slug: 'alice', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll', deathYear: 1898, firstPublishedYear: 1865, edition: 1890, archive: 'alicesadventurescarroll', filename: 'alicesadventurescarroll.pdf', country: 'CN', scope: 'regional', year: 1931, authority: 'Hunan (reported ban; historical details need curator review)', banSource: 'https://www.alice-in-wonderland.net/resources/faq/' },
  { id: 2, slug: 'huckleberry-finn', title: 'Adventures of Huckleberry Finn', author: 'Mark Twain', deathYear: 1910, firstPublishedYear: 1884, edition: 1885, archive: 'adventureshuckle00twaiiala', filename: 'adventureshuckle00twaiiala_bw.pdf', country: 'US', scope: 'library', year: 1885, authority: 'Concord Public Library', banSource: 'https://twain.lib.virginia.edu/huckfinn/hfconcrd.html' },
];
const books = [];
for (const sample of samples) {
  const file = new URL(`${sample.slug}.pdf`, root);
  let bytes;
  try { bytes = await readFile(file); }
  catch {
    const response = await fetch(`https://archive.org/download/${sample.archive}/${sample.filename}`);
    if (!response.ok) throw Error(`Download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 31457280 || bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('Invalid sample PDF');
    await writeFile(file, bytes);
  }
  if (bytes.length > 31457280 || bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('Invalid sample PDF');
  books.push({ id: sample.id, status: sample.id === 2 ? 'flagged' : 'approved', sampleFile: `./samples/${sample.slug}.pdf`, pdfSha256: `0x${createHash('sha256').update(bytes).digest('hex')}`, meta: {
    title: sample.title, authors: [{ name: sample.author, deathYear: sample.deathYear }], translators: [], firstPublishedYear: sample.firstPublishedYear,
    description: `${sample.edition} historical edition from Internet Archive. Local UI test sample; not scanned or curator approved.`,
    publicDomain: { sourceName: 'Internet Archive historical scan', sourceUrl: `https://archive.org/details/${sample.archive}` },
    bans: [{ country: sample.country, scope: sample.scope, year: sample.year, authority: sample.authority, sourceUrl: sample.banSource }],
  } });
  console.log(`${sample.title}: ${bytes.length} bytes`);
}
await writeFile(new URL('catalog.json', root), JSON.stringify({ source: 'snapshot', books }, null, 2));
