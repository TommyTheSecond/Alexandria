import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { filterBooks, type CatalogBook } from './catalog';
import './style.css';
import { verifiedSample } from './sample-download';
const sampleMode = new URLSearchParams(location.search).get('samples') === '1';

type Catalog = { books: CatalogBook[]; atBlock?: number };
const safeUrl = (url?: string) => url && /^https:\/\//i.test(url) ? url : undefined;
function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || '/');
  const [catalog, setCatalog] = useState<Catalog>({ books: [] });
  const [state, setState] = useState('Loading catalog…');
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [scope, setScope] = useState('');
  const [file, setFile] = useState<File>();
  const [message, setMessage] = useState('');
  useEffect(() => {
    const change = () => { setRoute(location.hash.slice(1) || '/'); setMessage(''); };
    addEventListener('hashchange', change);
    const controller = new AbortController();
    fetch(sampleMode ? './samples/catalog.json' : './catalog.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error('unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('books' in data) || !Array.isArray(data.books)
        || !data.books.every(b => b && typeof b.id === 'number' && typeof b.status === 'string'
          && (b.meta === null || (b.meta && typeof b.meta.title === 'string' && Array.isArray(b.meta.authors)
            && b.meta.authors.every((a: { name?: unknown }) => typeof a?.name === 'string') && Array.isArray(b.meta.bans)
            && b.meta.bans.every((ban: { country?: unknown; scope?: unknown }) => typeof ban?.country === 'string' && typeof ban?.scope === 'string'))))) throw Error('invalid');
      setCatalog(data as Catalog); setState('');
    }).catch(error => { if (error.name !== 'AbortError') setState('The catalog is not available yet. Please try again later.'); });
    return () => { removeEventListener('hashchange', change); controller.abort(); };
  }, []);
  const visible = filterBooks(catalog.books, query, country, scope);
  const book = catalog.books.find(b => b.id === Number(route.split('/')[2]) && ['approved', 'flagged'].includes(b.status));
  async function downloadSample(book: CatalogBook) {
    if (!sampleMode || !book.sampleFile || !/^\.\/samples\/[a-z-]+\.pdf$/.test(book.sampleFile) || !book.pdfSha256) return;
    setMessage('Checking sample PDF…');
    try {
      const response = await fetch(book.sampleFile);
      if (!response.ok) throw Error('Sample PDF is not reachable.');
      const blob = await verifiedSample(await response.arrayBuffer(), book.pdfSha256);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = book.sampleFile.split('/').pop()!;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Sample PDF verified and downloaded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Download failed.'); }
  }
  async function checkUpload(event: SubmitEvent) {
    event.preventDefault();
    if (!file) return setMessage('Choose a PDF first.');
    if (file.size > 31457280) return setMessage('The PDF must be 30 MB or smaller.');
    if (await file.slice(0, 5).text() !== '%PDF-') return setMessage('Choose a valid PDF file.');
    setMessage('PDF checks passed. Submission will be available when the scanner and SDK are connected. Nothing has been uploaded.');
  }
  return <>
    <a href="#content" onClick={event => { event.preventDefault(); document.getElementById('content')?.focus(); }}>Skip to content</a>
    <header><h1><a href="#/">Alexandria</a></h1><nav aria-label="Main navigation">
      <a href="#/">Catalog</a>{' · '}<a href="#/upload">Upload</a>{' · '}<a href="#/curate">Curate</a>{' · '}<a href="#/about">About</a>
    </nav></header>
    <main id="content" tabIndex={-1}>{sampleMode && <p>Local sample mode. Real public-domain scans; test statuses and ban records are not curator approvals or on-chain data. PDF hashes come from the local sample manifest.</p>}
      {route === '/' ? <>
        <h2>Public-domain banned books</h2><p>Find a book, read its ban history, and download a verified PDF.</p>
        {state ? <p role="status">{state}</p> : <p>Showing saved catalog{typeof catalog.atBlock === 'number' ? ` · data as of block ${catalog.atBlock}` : ''}.</p>}
        <label>Search title or author<input type="search" value={query} onInput={e => setQuery(e.currentTarget.value)} /></label>
        <label>Country<select aria-label="Country" value={country} onChange={e => setCountry(e.currentTarget.value)}><option value="">All countries</option>{[...new Set(catalog.books.flatMap(b => b.meta?.bans.map(ban => ban.country) ?? []))].sort().map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Ban scope<select aria-label="Ban scope" value={scope} onChange={e => setScope(e.currentTarget.value)}><option value="">All scopes</option>{['national','regional','import','postal','library','school','religious'].map(s => <option key={s}>{s}</option>)}</select></label>
        <p>{visible.length} books</p>
        {visible.map(b => <article key={b.id}><h3><a href={`#/book/${b.id}`}>{b.meta?.title ?? `Book ${b.id}`}</a></h3><p>{b.meta?.authors.map(a => a.name).join(', ')}{b.meta?.firstPublishedYear ? ` · ${b.meta.firstPublishedYear}` : ''}</p><p>{[...new Set(b.meta?.bans.map(ban => ban.country))].join(' · ')}{b.status === 'flagged' ? ' · Under review' : ''}</p></article>)}
        {!state && !visible.length && <p>No books match your search.</p>}
      </> : route.startsWith('/book/') ? <>
        <a href="#/">Back to catalog</a>{book ? <><h2>{book.meta?.title ?? `Book ${book.id}`}</h2><p>{book.meta?.authors.map(a => a.name).join(', ')}</p><p>{book.meta?.firstPublishedYear}</p><p>{book.meta?.description}</p>{book.status === 'flagged' && <p>Under review. This book remains available.</p>}<h3>Ban history</h3><ul>{book.meta?.bans.map((ban, i) => <li key={i}>{[ban.year, ban.country, ban.authority, ban.scope].filter(Boolean).join(' · ')} {safeUrl(ban.sourceUrl) && <a href={safeUrl(ban.sourceUrl)}>Source</a>}</li>)}</ul>{safeUrl(book.meta?.publicDomain?.sourceUrl) && <p><a href={safeUrl(book.meta?.publicDomain?.sourceUrl)}>Public-domain source</a></p>}{sampleMode && book.sampleFile ? <button type="button" onClick={() => downloadSample(book)}>Download sample PDF</button> : <p>Verified PDF downloads will be available when the SDK is connected.</p>}<p>Wallet flagging is not connected yet.</p></> : <p>{state || 'Book not found.'}</p>}
      </> : route === '/upload' ? <>
        <h2>Upload a book</h2><p>Only public-domain PDFs. First published in 1930 or earlier, with every author and translator deceased by 1955. Unknown years require curator review.</p>
        <p>This is a local form preview. Uploading is not connected yet.</p>
        <form onSubmit={checkUpload}><label>PDF (up to 30 MB)<input type="file" accept="application/pdf,.pdf" required onChange={e => setFile(e.currentTarget.files?.[0])} /></label><label>Title<input name="title" required maxLength={300} /></label><label>Authors<input name="authors" required /></label><label>Translators, if any<input name="translators" /></label><label>First publication year<input name="year" type="number" min="-3000" max="2026" required /></label><label>Public-domain source URL<input name="source" type="url" required /></label><label>Ban country (two-letter code)<input name="country" pattern="[A-Z]{2}" required /></label><label>Ban source URL<input name="banSource" type="url" required /></label><button type="submit">Check PDF</button></form>
      </> : route === '/curate' ? <><h2>Curate submissions</h2><p>Curators approve or reject books after reviewing the scan report.</p><p>Wallet connection and the pending queue will be available when the SDK is connected.</p></> : route === '/about' ? <><h2>About Alexandria</h2><p>A library of banned books in the public domain, named after the Library of Alexandria.</p><p>Reading and downloading do not require an account or wallet. PDFs are intended to be checked against their on-chain SHA-256 hash before saving.</p><p>The registry uses Avalanche Fuji testnet; files use IPFS. Mirror addresses will appear here once configured.</p><p>Unaudited · Fuji testnet only.</p></> : <><h2>Page not found</h2><a href="#/">Return to catalog</a></>}
      {message && <p role="status">{message}</p>}
    </main><footer><p>Unaudited · Fuji testnet only</p></footer>
  </>;
}
render(<App />, document.getElementById('app')!);
