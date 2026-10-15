import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { filterBooks, type CatalogBook } from './catalog';
import './style.css';
import { verifiedSample } from './sample-download';
import { HeaderArt } from './HeaderArt';
import { AthensArt } from './AthensArt';
const politicalMode = new URLSearchParams(location.search).get('collection') === 'political';
const sampleMode = politicalMode || new URLSearchParams(location.search).get('samples') === '1';

type Catalog = { books: CatalogBook[]; atBlock?: number };
const safeUrl = (url?: string) => url && /^https:\/\//i.test(url) ? url : undefined;
function App() {
  const [theme, setTheme] = useState(() => {
    try { const saved = localStorage.getItem('alexandria-color-mode'); if (saved === 'light' || saved === 'dark') return saved; } catch { /* Storage may be disabled in Tor. */ }
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('alexandria-color-mode', theme); } catch { /* Theme still works without persistence. */ }
  }, [theme]);
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
    fetch(politicalMode ? './political/catalog.json' : sampleMode ? './samples/catalog.json' : './catalog.json', { signal: controller.signal }).then(async response => {
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
  const visible = filterBooks(catalog.books, query, country, scope, politicalMode);
  const book = catalog.books.find(b => b.id === Number(route.split('/')[2]) && (['approved', 'flagged'].includes(b.status) || (politicalMode && b.status === 'local')));
  async function downloadSample(book: CatalogBook) {
    if (!sampleMode || !book.sampleFile || !/^\.\/(?:samples|political)\/[a-z-]+\.pdf$/.test(book.sampleFile) || !book.pdfSha256) return;
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
      setMessage(politicalMode ? 'PDF verified against the local source manifest and downloaded.' : 'Sample PDF verified and downloaded.');
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
    <a className="skip" href="#content" onClick={event => { event.preventDefault(); document.getElementById('content')?.focus(); }}>Skip to content</a>
    <header className="site-header">
      <div className="topline"><span>AN INDEPENDENT LIBRARY OF BANNED BOOKS</span><span>EST. 2026 / VOL. 001</span></div>
      <HeaderArt />
      <div className="navline"><nav aria-label="Main navigation">
        {[['/', '01', 'Catalog'], ['/upload', '02', 'Upload'], ['/curate', '03', 'Curate'], ['/about', '04', 'About']].map(([path, number, label]) => <a key={path} href={`#${path}`} aria-current={route === path ? 'page' : undefined}><span aria-hidden="true">[ {number} </span>{label}<span aria-hidden="true"> ]</span></a>)}
      </nav><button className="theme-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>[ {theme === 'light' ? '*' : ':'} {theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'} ]</button></div>
      <div className="ascii-rule" aria-hidden="true">{'='.repeat(180)}</div>
    </header>
    <main id="content" tabIndex={-1}>{sampleMode && <aside className="sample-notice"><span>[ LOCAL READING ROOM ]</span> {politicalMode ? 'Historical political reading collection. Local downloads; source and edition review still required. Books have not passed the scanner or curator approval. Ban history is not yet researched. Hashes are from the local manifest.' : 'Public-domain sample scans. Test statuses; no curator approvals or on-chain records. Downloads use local SHA-256 hashes.'}</aside>}
      {route === '/' ? <>
        <section className="hero" aria-labelledby="hero-title"><div className="hero-copy"><p className="eyebrow">[ KNOWLEDGE BELONGS TO EVERYONE ]</p><h2 id="hero-title">A library<br />without walls.</h2><p>Some books were banned.<br />Their ideas kept going.</p><p>A public-domain collection for the curious, the questioning, and everyone who believes a book should be read.</p><a className="text-action" href="#collection" onClick={event => { event.preventDefault(); document.getElementById('collection')?.scrollIntoView(); document.getElementById('collection')?.focus(); }}>Enter the collection <span aria-hidden="true">--&gt;</span></a><p className="hero-note">NO ACCOUNT. NO WALLET. JUST WORDS.</p></div><figure className="library-figure"><AthensArt /><figcaption className="sr-only">Raphael's The School of Athens, rendered as a static grayscale ASCII picture: vaulted classical architecture frames Plato, Aristotle and the gathering of philosophers.</figcaption><p className="art-caption">FIG. 01 / THE SCHOOL OF ATHENS<br />RAPHAEL / 1511 / RENDERED IN CHARACTERS</p></figure></section>
        <div className="principles"><span>[01] FREE TO READ</span><span>[02] PUBLIC DOMAIN</span><span>[03] BUILT TO ENDURE</span></div>
        <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>
        <section className="collection" id="collection" tabIndex={-1}><div className="section-heading"><div><p className="eyebrow">THE READING ROOM / INDEX 001</p><h2>The collection</h2></div><p className="collection-count">{visible.length} books</p></div>
        {state ? <p role="status">{state}</p> : <p>{politicalMode ? 'Showing local political reading collection' : 'Showing saved catalog'}{typeof catalog.atBlock === 'number' ? ` · data as of block ${catalog.atBlock}` : ''}.</p>}
        <div className="filters"><label className="search-label">Search title or author<input type="search" placeholder="Title, author, a little curiosity..." value={query} onInput={e => setQuery(e.currentTarget.value)} /></label>
        <label>Country<select aria-label="Country" value={country} onChange={e => setCountry(e.currentTarget.value)}><option value="">All countries</option>{[...new Set(catalog.books.flatMap(b => b.meta?.bans.map(ban => ban.country) ?? []))].sort().map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Ban scope<select aria-label="Ban scope" value={scope} onChange={e => setScope(e.currentTarget.value)}><option value="">All scopes</option>{['national','regional','import','postal','library','school','religious'].map(s => <option key={s}>{s}</option>)}</select></label></div>
        <div className="book-grid">{visible.map(b => <article className="book-card" key={b.id}><div className="ascii-rule" aria-hidden="true">{'+' + '-'.repeat(90) + '+'}</div><div className="card-top"><span>CAT. {String(b.id).padStart(3, '0')}</span><span>{b.meta?.firstPublishedYear ?? 'UNDATED'}</span></div><div className="card-body"><pre className="book-symbol" aria-hidden="true">{'  ___   ___\n /   \\ /   \\\n| --- | --- |\n| --- | --- |\n|_____|_____|\n      V'}</pre><div><h3><a href={`#/book/${b.id}`}>{b.meta?.title ?? `Book ${b.id}`}</a></h3><p>{b.meta?.authors.map(a => a.name).join(', ')}</p></div></div><p className="book-countries">{b.meta?.bans.length ? 'BAN RECORDS / ' + [...new Set(b.meta.bans.map(ban => ban.country))].join(' + ') : 'POLITICAL TEXT / BAN RESEARCH PENDING'}{b.status === 'flagged' ? ' / UNDER REVIEW' : ''}</p><div className="card-bottom"><span>{sampleMode ? 'LOCAL SAMPLE / PDF' : 'PUBLIC DOMAIN'}</span><a href={`#/book/${b.id}`} aria-label={`Open ${b.meta?.title ?? `book ${b.id}`}`}>[ READ --&gt; ]</a></div><div className="ascii-rule" aria-hidden="true">{'+' + '-'.repeat(90) + '+'}</div></article>)}</div>
        {!state && !visible.length && <p className="empty-state">[ No books on this shelf yet. Try another search. ]</p>}
        </section><section className="closing-note"><div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div><p>They burned the first library.<br /><strong>We are building the next one together.</strong></p><a href="#/upload">[ CONTRIBUTE A BOOK --&gt; ]</a></section>
      </> : route.startsWith('/book/') ? <>
        <a href="#/">Back to catalog</a>{book ? <><h2>{book.meta?.title ?? `Book ${book.id}`}</h2><p>{book.meta?.authors.map(a => a.name).join(', ')}</p><p>{book.meta?.firstPublishedYear}</p><p>{book.meta?.description}</p>{book.status === 'flagged' && <p>Under review. This book remains available.</p>}<h3>Ban history</h3>{!book.meta?.bans.length && <p>Not yet researched. Inclusion in this political collection is not a claim that the book was banned.</p>}<ul>{book.meta?.bans.map((ban, i) => <li key={i}>{[ban.year, ban.country, ban.authority, ban.scope].filter(Boolean).join(' · ')} {safeUrl(ban.sourceUrl) && <a href={safeUrl(ban.sourceUrl)}>Source</a>}</li>)}</ul>{safeUrl(book.meta?.publicDomain?.sourceUrl) && <p><a href={safeUrl(book.meta?.publicDomain?.sourceUrl)}>Public-domain source</a></p>}{sampleMode && book.sampleFile ? <button type="button" onClick={() => downloadSample(book)}>{politicalMode ? 'Download PDF' : 'Download sample PDF'}</button> : <p>Verified PDF downloads will be available when the SDK is connected.</p>}<p>Wallet flagging is not connected yet.</p></> : <p>{state || 'Book not found.'}</p>}
      </> : route === '/upload' ? <>
        <h2>Upload a book</h2><p>Only public-domain PDFs. First published in 1930 or earlier, with every author and translator deceased by 1955. Unknown years require curator review.</p>
        <p>This is a local form preview. Uploading is not connected yet.</p>
        <form onSubmit={checkUpload}><label>PDF (up to 30 MB)<input type="file" accept="application/pdf,.pdf" required onChange={e => setFile(e.currentTarget.files?.[0])} /></label><label>Title<input name="title" required maxLength={300} /></label><label>Authors<input name="authors" required /></label><label>Translators, if any<input name="translators" /></label><label>First publication year<input name="year" type="number" min="-3000" max="2026" required /></label><label>Public-domain source URL<input name="source" type="url" required /></label><label>Ban country (two-letter code)<input name="country" pattern="[A-Z]{2}" required /></label><label>Ban source URL<input name="banSource" type="url" required /></label><button type="submit">Check PDF</button></form>
      </> : route === '/curate' ? <><h2>Curate submissions</h2><p>Curators approve or reject books after reviewing the scan report.</p><p>Wallet connection and the pending queue will be available when the SDK is connected.</p></> : route === '/about' ? <><h2>About Alexandria</h2><p>A library of banned books in the public domain, named after the Library of Alexandria.</p><p>Reading and downloading do not require an account or wallet. PDFs are intended to be checked against their on-chain SHA-256 hash before saving.</p><p>The registry uses Avalanche Fuji testnet; files use IPFS. Mirror addresses will appear here once configured.</p><p>Unaudited · Fuji testnet only.</p></> : <><h2>Page not found</h2><a href="#/">Return to catalog</a></>}
      {message && <p role="status">{message}</p>}
    </main><footer><div className="ascii-rule" aria-hidden="true">{'='.repeat(180)}</div><div className="footer-grid"><p>ALEXANDRIA<br /><span>A home for words that would not disappear.</span></p><p>PUBLIC DOMAIN / OPEN ACCESS<br />Unaudited · Fuji testnet only</p></div><p className="footer-colophon">SET IN CHARACTERS. HELD IN COMMON. <span aria-hidden="true">[ EOF ]</span></p></footer>
  </>;
}
render(<App />, document.getElementById('app')!);
