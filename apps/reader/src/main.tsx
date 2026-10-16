import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { filterBooks, type CatalogBook } from './catalog';
import './style.css';
import { verifiedSample } from './sample-download';
import { HeaderArt } from './HeaderArt';
import { AthensArt } from './AthensArt';
import { AlexandriaError, type AlexandriaClient, type Book, type BookMetaInput, type ScanReport, type WalletActions } from '@alexandria/sdk';
import { connectReader } from './reader-client';
import { ALLOW_REUPLOADS, buildReuploadPdf, isReuploadAllowed, sortPendingByScore } from './reader-config';
import { PendingCard } from './PendingCard';
import { DonatePage } from './DonatePage';
import { NodesPage } from './NodesPage';
import { BountiesPage, BountyCurationPanel } from './BountiesPage';
import { bountyDeployment } from './bounty-deployment';
import rpcConfig from '../../../infra/rpcs.json';

const fundRecords = import.meta.glob<{ address?: unknown; deployBlock?: unknown }>(
  '../../../deployments/fuji-fund.json', { eager: true, import: 'default' },
);
const fundRecord = Object.values(fundRecords)[0];
const fundDeployment = fundRecord && typeof fundRecord.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(fundRecord.address)
  ? { address: fundRecord.address as `0x${string}`, deployBlock: typeof fundRecord.deployBlock === 'number' ? fundRecord.deployBlock : 0 }
  : null;

// Book bounties (I9) show up once deployments/fuji-bounties.json exists; ?bounties=1 shows the page before that.
export const bountiesEnabled = Boolean(bountyDeployment?.address) ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).get('bounties') === '1');
// Local testing only (dev server): ?rpc=http://127.0.0.1:8545 points the bounty pages at a local chain.
const bountyRpcOverride = (import.meta as any).env?.DEV && typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('rpc') ?? '' : '';
const bountyRpcUrls = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(bountyRpcOverride) ? [bountyRpcOverride]
  : typeof location !== 'undefined' && location.hostname.endsWith('.onion') ? rpcConfig.onion : rpcConfig.clearnet;

// Toggle Alexandria Fund (Donations & Paid Nodes) feature:
// Set to true to enable permanently, or toggle at runtime with ?fund=1 or VITE_ENABLE_FUND=true.
export const ENABLE_FUND = false;

const fundQuery = typeof location !== 'undefined' && (
  new URLSearchParams(location.search).get('fund') === '1' ||
  location.hash.includes('fund=1')
);
export const fundEnabled = ENABLE_FUND || Boolean(
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ENABLE_FUND === 'true') || fundQuery
);

const politicalMode = new URLSearchParams(location.search).get('collection') === 'political';
const sampleMode = politicalMode || new URLSearchParams(location.search).get('samples') === '1';

type Catalog = { books: CatalogBook[]; atBlock?: number; source?: 'live' | 'snapshot' };
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
  const [submissionTx, setSubmissionTx] = useState<string | null>(null);
  const [bountyPrefill, setBountyPrefill] = useState<number | null>(null);
  const [client, setClient] = useState<AlexandriaClient | null>(null);
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [runtimeAllowReuploads, setRuntimeAllowReuploads] = useState<boolean | undefined>(undefined);
  const [onionUrl, setOnionUrl] = useState('');
  const [reportGateway, setReportGateway] = useState('');
  const [progress, setProgress] = useState(0);
  const [wallet, setWallet] = useState<WalletActions | null>(null);
  const [pending, setPending] = useState<Book[]>([]);
  const [isCurator, setIsCurator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [duplicateId, setDuplicateId] = useState<number | null>(null);
  const [reports, setReports] = useState<Record<number, ScanReport | null>>({});
  useEffect(() => {
    const change = () => { setRoute(location.hash.slice(1) || '/'); setMessage(''); setSubmissionTx(null); setScanReport(null); setDuplicateId(null); };
    addEventListener('hashchange', change);
    const controller = new AbortController();
    let active = true;
    if (!sampleMode) {
      let refreshing = false;
      let liveClient: AlexandriaClient | undefined;
      const refresh = async () => {
        if (!liveClient || refreshing || !active) return;
        refreshing = true;
        try {
          const data = await liveClient.getCatalog();
          if (active) { setCatalog(data); setState(''); }
        } catch { /* Keep the rendered snapshot and retry next time. */ }
        finally { refreshing = false; }
      };
      connectReader().then(async connection => {
        if (!active) return;
        setClient(connection.client);
        setUploadEnabled(connection.uploadEnabled);
        setRuntimeAllowReuploads(connection.allowReuploads);
        setOnionUrl(connection.onionUrl);
        setReportGateway(connection.reportGateway);
        liveClient = connection.client;
        try {
          const data = await connection.client.getCatalog({ live: false });
          if (active) { setCatalog(data); setState(''); }
        } catch { if (active) setState('Saved catalog unavailable. Trying live data...'); }
        await refresh();
      }).catch(() => { if (active) setState('The catalog is not available yet. Please try again later.'); });
      const timer = setInterval(refresh, 30000);
      const focused = () => { void refresh(); };
      addEventListener('focus', focused);
      return () => { active = false; clearInterval(timer); removeEventListener('focus', focused); removeEventListener('hashchange', change); controller.abort(); };
    }
    fetch(politicalMode ? './political/catalog.json' : './samples/catalog.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error('unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('books' in data) || !Array.isArray(data.books)
        || !data.books.every(b => b && typeof b.id === 'number' && typeof b.status === 'string'
          && (b.meta === null || (b.meta && typeof b.meta.title === 'string' && Array.isArray(b.meta.authors)
            && b.meta.authors.every((a: { name?: unknown }) => typeof a?.name === 'string') && Array.isArray(b.meta.bans)
            && b.meta.bans.every((ban: { country?: unknown; scope?: unknown }) => typeof ban?.country === 'string' && typeof ban?.scope === 'string'))))) throw Error('invalid');
      setCatalog(data as Catalog); setState('');
    }).catch(error => { if (error.name !== 'AbortError') setState('The catalog is not available yet. Please try again later.'); });
    return () => { active = false; removeEventListener('hashchange', change); controller.abort(); };
  }, []);
  const visible = filterBooks(catalog.books, query, country, scope, politicalMode);
  const book = catalog.books.find(b => b.id === Number(route.split('/')[2]) && (['approved', 'flagged'].includes(b.status) || (politicalMode && b.status === 'local')));
  const reportUrl = (cid: string | null | undefined) => cid && /^baf[a-z2-7]{20,97}$/.test(cid) ? `${reportGateway}/ipfs/${cid}` : undefined;
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
  async function downloadBook(book: CatalogBook, allowPending = false) {
    if (!client || !(['approved', 'flagged'].includes(book.status) || (allowPending && book.status === 'pending')) ||
        !/^baf[a-z2-7]{20,97}$/.test(book.pdfCid ?? '') || !/^0x[0-9a-f]{64}$/.test(book.pdfSha256 ?? '')) {
      setMessage('This book does not have a verified PDF available yet.');
      return;
    }
    setBusy(true); setProgress(0); setMessage('Downloading and verifying PDF…');
    try {
      const blob = await client.downloadPdf(book as Book, { onProgress: bytes => setProgress(bytes) });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = client.pdfFileName(book as Book);
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('PDF verified and downloaded.');
    } catch (error) {
      if (error instanceof AlexandriaError && error.code === 'INTEGRITY') setMessage('A gateway sent a damaged copy. Nothing was saved.');
      else if (error instanceof AlexandriaError && error.code === 'UNREACHABLE') setMessage(`No gateway reachable. Try the onion mirror: ${onionUrl || 'address unavailable'}`);
      else setMessage('The PDF could not be downloaded. Nothing was saved.');
    } finally { setBusy(false); }
  }
  async function checkUpload(event: SubmitEvent) {
    event.preventDefault();
    setSubmissionTx(null);
    const form = event.currentTarget as HTMLFormElement;
    if (!file) return setMessage('Choose a PDF first.');
    if (file.size > 31457280) return setMessage('The PDF must be 30 MB or smaller.');
    if (await file.slice(0, 5).text() !== '%PDF-') return setMessage('Choose a valid PDF file.');
    if (!client || !uploadEnabled) return setMessage('Uploads are not available from this mirror yet.');
    const values = new FormData(form);
    const value = (name: string) => String(values.get(name) ?? '').trim();
    const deathYear = (name: string) => value(name) ? Number(value(name)) : null;
    const meta: BookMetaInput = {
      title: value('title'), authors: [{ name: value('authors'), deathYear: deathYear('authorDeath') }],
      translators: value('translators') ? [{ name: value('translators'), deathYear: deathYear('translatorDeath') }] : [],
      firstPublishedYear: Number(value('year')), language: value('language'), description: value('description'),
      publicDomain: { sourceName: value('sourceName'), sourceUrl: value('source') },
      bans: [{ country: value('country').toUpperCase(), authority: value('authority'), year: Number(value('banYear')),
        scope: value('scope') as BookMetaInput['bans'][number]['scope'], sourceUrl: value('banSource') }],
    };
    // Optional bounty fields (I2/I9): only sent when the uploader answers a bounty.
    const bountyId = bountiesEnabled && value('bountyId') ? Number(value('bountyId')) : 0;
    const contributor = value('contributor');
    if (bountyId && !(Number.isSafeInteger(bountyId) && bountyId > 0)) return setMessage('Enter a valid bounty number.');
    if (bountyId && !/^0x[0-9a-fA-F]{40}$/.test(contributor)) return setMessage('Enter the 0x… address that should receive the bounty.');
    const upload: BookMetaInput = bountyId ? { ...meta, ...{ bountyId, contributor } } : meta;
    setBusy(true); setScanReport(null); setDuplicateId(null); setMessage('Scanning and submitting PDF…');
    try {
      let result;
      try {
        result = await client.submit(file, upload);
      } catch (firstErr) {
        const canReupload = isReuploadAllowed(
          typeof location !== 'undefined' ? location.search : '',
          runtimeAllowReuploads,
          typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_ALLOW_REUPLOADS : undefined,
        );
        if (canReupload && firstErr instanceof AlexandriaError && firstErr.code === 'DUPLICATE') {
          const reuploadFile = buildReuploadPdf(file);
          if (reuploadFile.size <= 31457280) {
            result = await client.submit(reuploadFile, upload);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      setScanReport(result.report);
      if (result.report.verdict !== 'reject' && /^0x[0-9a-fA-F]{64}$/.test(result.txHash ?? '')) {
        setSubmissionTx(result.txHash);
      }
      const failed = result.report.checks?.filter(check => !check.passed).map(check => check.id).join(', ');
      setMessage(result.report.verdict === 'reject' ? `Rejected: ${failed || 'scanner checks failed'}. Nothing was uploaded.` :
        `Submitted as book #${result.bookId}. A curator must review it before it appears in the catalog.`);
    } catch (error) {
      if (error instanceof AlexandriaError) {
        const detail = error.detail as { existingId?: number; retryAfterSec?: number } | undefined;
        if (error.code === 'DUPLICATE') { setDuplicateId(detail?.existingId ?? null); setMessage('This PDF is already registered.'); }
        else if (error.code === 'RATE_LIMIT') setMessage(`Upload limit reached. Try again in ${detail?.retryAfterSec ?? 'a few'} seconds.`);
        else if (error.code === 'TOO_LARGE') setMessage('Choose a PDF smaller than 30 MB.');
        else setMessage(`${error.code}: ${error.message}`);
      } else setMessage('Submission failed. Please try again.');
    } finally { setBusy(false); }
  }
  async function refreshPending(queueClient: AlexandriaClient) {
    const books = await queueClient.getPending();
    const loaded = await Promise.all(books.map(async item => {
      const url = reportUrl(item.meta?.scanReportCid);
      if (!url) return [item.id, null] as const;
      try {
        const response = await fetch(url);
        if (!response.ok) return [item.id, null] as const;
        const report = await response.json() as ScanReport;
        return [item.id, Number.isFinite(report.score) && Array.isArray(report.checks) ? report : null] as const;
      } catch { return [item.id, null] as const; }
    }));
    const byId = Object.fromEntries(loaded) as Record<number, ScanReport | null>;
    setReports(byId);
    const scores = Object.fromEntries(loaded.filter(([, report]) => report).map(([id, report]) => [id, report!.score]));
    setPending(sortPendingByScore(books, scores));
  }
  async function connectCurator() {
    if (!client) return;
    setBusy(true);
    try {
      const actions = await client.connectWallet();
      if (!await actions.isCurator()) { setMessage('This wallet does not have the curator role.'); return; }
      setWallet(actions); setIsCurator(true); await refreshPending(client); setMessage('Curator wallet connected.');
    } catch (error) { setMessage(error instanceof AlexandriaError ? `${error.code}: ${error.message}` : 'Wallet connection failed.'); }
    finally { setBusy(false); }
  }
  async function reviewBook(id: number, approve: boolean) {
    if (!client || !wallet) return;
    const reason = (document.getElementById(`reason-${id}`) as HTMLInputElement | null)?.value.trim() ?? '';
    if (!reason) return setMessage('Enter a review reason first.');
    setBusy(true);
    try {
      await wallet.review(id, approve, reason);
      await refreshPending(client);
      setCatalog(await client.getCatalog());
      setMessage(`Book #${id} ${approve ? 'approved' : 'rejected'}.`);
    } catch (error) { setMessage(error instanceof AlexandriaError ? `${error.code}: ${error.message}` : 'Review failed.'); }
    finally { setBusy(false); }
  }
  async function flagBook(id: number) {
    if (!client) return;
    const reason = (document.getElementById('flag-reason') as HTMLInputElement | null)?.value.trim() ?? '';
    if (!reason) return setMessage('Enter a flag reason first.');
    setBusy(true);
    try {
      const actions = wallet ?? await client.connectWallet();
      await actions.flag(id, reason);
      setCatalog(await client.getCatalog());
      setMessage('Flag recorded. The book remains available while under review.');
    } catch (error) { setMessage(error instanceof AlexandriaError ? `${error.code}: ${error.message}` : 'Flag failed.'); }
    finally { setBusy(false); }
  }
  return <>
    <a className="skip" href="#content" onClick={event => { event.preventDefault(); document.getElementById('content')?.focus(); }}>Skip to content</a>
    <header className="site-header">
      <div className="topline"><span>AN INDEPENDENT LIBRARY OF BANNED BOOKS</span><span>EST. 2026 / VOL. 001</span></div>
      <HeaderArt />
      <div className="navline"><nav aria-label="Main navigation">
        {[
          ['/', '01', 'Catalog'],
          ['/upload', '02', 'Upload'],
          ['/curate', '03', 'Curate'],
          ...(fundEnabled ? [['/donate', '04', 'Donate'], ['/nodes', '05', 'Nodes']] : []),
          ...(bountiesEnabled ? [['/bounties', '', 'Bounties']] : []),
          ['/about', '', 'About'],
        ].map(([path, , label], index) => [path, String(index + 1).padStart(2, '0'), label]).map(([path, number, label]) => <a key={path} href={`#${path}`} aria-current={route === path ? 'page' : undefined}><span aria-hidden="true">[ {number} </span>{label}<span aria-hidden="true"> ]</span></a>)}
      </nav><button className="theme-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>[ {theme === 'light' ? '*' : ':'} {theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'} ]</button></div>
      <div className="ascii-rule" aria-hidden="true">{'='.repeat(180)}</div>
    </header>
    <main id="content" tabIndex={-1}>{sampleMode && <aside className="sample-notice"><span>[ LOCAL READING ROOM ]</span> {politicalMode ? 'Historical political reading collection. Local downloads; source and edition review still required. Books have not passed the scanner or curator approval. Ban history is not yet researched. Hashes are from the local manifest.' : 'Public-domain sample scans. Test statuses; no curator approvals or on-chain records. Downloads use local SHA-256 hashes.'}</aside>}
      {route === '/' ? <>
        <section className="hero" aria-labelledby="hero-title"><div className="hero-copy"><p className="eyebrow">[ KNOWLEDGE BELONGS TO EVERYONE ]</p><h2 id="hero-title">A library<br />without walls.</h2><p>Some books were banned.<br />Their ideas kept going.</p><p>A public-domain collection for the curious, the questioning, and everyone who believes a book should be read.</p><a className="text-action" href="#collection" onClick={event => { event.preventDefault(); document.getElementById('collection')?.scrollIntoView(); document.getElementById('collection')?.focus(); }}>Enter the collection <span aria-hidden="true">--&gt;</span></a><p className="hero-note">NO ACCOUNT. NO WALLET. JUST WORDS.</p></div><figure className="library-figure"><AthensArt /><figcaption className="sr-only">Raphael's The School of Athens, rendered as a static grayscale ASCII picture: vaulted classical architecture frames Plato, Aristotle and the gathering of philosophers.</figcaption><p className="art-caption">FIG. 01 / THE SCHOOL OF ATHENS<br />RAPHAEL / 1511 / RENDERED IN CHARACTERS</p></figure></section>
        <div className="principles"><span>[01] FREE TO READ</span><span>[02] PUBLIC DOMAIN</span><span>[03] BUILT TO ENDURE</span></div>
        <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>
        <section className="collection" id="collection" tabIndex={-1}><div className="section-heading"><div><p className="eyebrow">THE READING ROOM / INDEX 001</p><h2>The collection</h2></div><p className="collection-count">{visible.length} books</p></div>
        {state ? <p role="status">{state}</p> : <p>{politicalMode ? 'Showing local political reading collection' : sampleMode ? 'Showing local samples' : catalog.source === 'live' ? 'Showing live catalog' : 'Showing saved catalog'}{typeof catalog.atBlock === 'number' ? ` · data as of block ${catalog.atBlock}` : ''}.</p>}
        <div className="filters"><label className="search-label">Search title or author<input type="search" placeholder="Title, author, a little curiosity..." value={query} onInput={e => setQuery(e.currentTarget.value)} /></label>
        <label>Country<select aria-label="Country" value={country} onChange={e => setCountry(e.currentTarget.value)}><option value="">All countries</option>{[...new Set(catalog.books.flatMap(b => b.meta?.bans.map(ban => ban.country) ?? []))].sort().map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Ban scope<select aria-label="Ban scope" value={scope} onChange={e => setScope(e.currentTarget.value)}><option value="">All scopes</option>{['national','regional','import','postal','library','school','religious'].map(s => <option key={s}>{s}</option>)}</select></label></div>
        <div className="book-grid">{visible.map(b => <article className="book-card" key={b.id}><div className="ascii-rule" aria-hidden="true">{'+' + '-'.repeat(90) + '+'}</div><div className="card-top"><span>CAT. {String(b.id).padStart(3, '0')}</span><span>{b.meta?.firstPublishedYear ?? 'UNDATED'}</span></div><div className="card-body"><pre className="book-symbol" aria-hidden="true">{'  ___   ___\n /   \\ /   \\\n| --- | --- |\n| --- | --- |\n|_____|_____|\n      V'}</pre><div><h3><a href={`#/book/${b.id}`}>{b.meta?.title ?? `Book ${b.id}`}</a></h3><p>{b.meta?.authors.map(a => a.name).join(', ')}</p></div></div><p className="book-countries">{b.meta?.bans.length ? 'BAN RECORDS / ' + [...new Set(b.meta.bans.map(ban => ban.country))].join(' + ') : 'POLITICAL TEXT / BAN RESEARCH PENDING'}{b.status === 'flagged' ? ' / UNDER REVIEW' : ''}</p><div className="card-bottom"><span>{sampleMode ? 'LOCAL SAMPLE / PDF' : 'PUBLIC DOMAIN'}</span><a href={`#/book/${b.id}`} aria-label={`Open ${b.meta?.title ?? `book ${b.id}`}`}>[ READ --&gt; ]</a></div><div className="ascii-rule" aria-hidden="true">{'+' + '-'.repeat(90) + '+'}</div></article>)}</div>
        {!state && !visible.length && <p className="empty-state">[ No books on this shelf yet. Try another search. ]</p>}
        </section><section className="closing-note"><div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div><p>They burned the first library.<br /><strong>We are building the next one together.</strong></p><a href="#/upload">[ CONTRIBUTE A BOOK --&gt; ]</a></section>
      </> : route.startsWith('/book/') ? <>
        <a href="#/">Back to catalog</a>{book ? <><h2>{book.meta?.title ?? `Book ${book.id}`}</h2><p>{book.meta?.authors.map(a => a.name).join(', ')}</p><p>{book.meta?.firstPublishedYear}</p><p>{book.meta?.description}</p>{book.status === 'flagged' && <p>Under review. This book remains available.</p>}<h3>Ban history</h3>{!book.meta?.bans.length && <p>Not yet researched. Inclusion in this political collection is not a claim that the book was banned.</p>}<ul>{book.meta?.bans.map((ban, i) => <li key={i}>{[ban.year, ban.country, ban.authority, ban.scope].filter(Boolean).join(' · ')} {safeUrl(ban.sourceUrl) && <a href={safeUrl(ban.sourceUrl)}>Source</a>}</li>)}</ul>{safeUrl(book.meta?.publicDomain?.sourceUrl) && <p><a href={safeUrl(book.meta?.publicDomain?.sourceUrl)}>Public-domain source</a></p>}{sampleMode && book.sampleFile ? <button type="button" onClick={() => downloadSample(book)}>{politicalMode ? 'Download PDF' : 'Download sample PDF'}</button> : <><button type="button" disabled={busy || !client} onClick={() => downloadBook(book)}>Download PDF{book.meta?.pdf?.bytes ? ` · ${(book.meta.pdf.bytes / 1024 / 1024).toFixed(1)} MB` : ''}</button>{progress > 0 && <><progress value={progress} max={book.meta?.pdf?.bytes || progress} aria-label="PDF download progress" /><p role="status">Received {(progress / 1024 / 1024).toFixed(1)} MB; verifying before saving.</p></>}<label>Reason for flagging<input id="flag-reason" maxLength={300} /></label><button type="button" disabled={busy || !client} onClick={() => flagBook(book.id)}>Flag for curator review</button></>}</> : <p>{state || 'Book not found.'}</p>}
      </> : route === '/upload' ? <>
        <h2>Upload a book</h2><p>Only public-domain PDFs. First published in 1930 or earlier, with every author and translator deceased by 1955. Unknown years require curator review.</p>
        {!uploadEnabled && <p>Uploads are not available from this mirror yet. Reading and downloads still work.</p>}
        <form onSubmit={checkUpload}><label>PDF (up to 30 MB)<input type="file" accept="application/pdf,.pdf" required onChange={e => setFile(e.currentTarget.files?.[0])} /></label><label>Title<input name="title" required maxLength={300} /></label><label>Author<input name="authors" required /></label><label>Author death year, if known<input name="authorDeath" type="number" max="2026" /></label><label>Translator, if any<input name="translators" /></label><label>Translator death year, if known<input name="translatorDeath" type="number" max="2026" /></label><label>First publication year<input name="year" type="number" min="-3000" max="2026" required /></label><label>Language code<input name="language" defaultValue="en" pattern="[a-z]{2,3}(-[A-Za-z0-9]{2,8})*" required /></label><label>Description<input name="description" maxLength={1000} /></label><label>Public-domain source name<input name="sourceName" required /></label><label>Public-domain source URL<input name="source" type="url" required /></label><label>Ban country (two-letter code)<input name="country" pattern="[A-Za-z]{2}" required /></label><label>Ban authority<input name="authority" required /></label><label>Ban year<input name="banYear" type="number" min="-3000" max="2026" required /></label><label>Ban scope<select name="scope" required>{['national','regional','import','postal','library','school','religious'].map(s => <option key={s}>{s}</option>)}</select></label><label>Ban source URL<input name="banSource" type="url" required /></label>{bountiesEnabled && <fieldset><legend>Answering a bounty? (optional)</legend><label>Bounty number<input name="bountyId" type="number" min="1" key={bountyPrefill ?? 'none'} defaultValue={bountyPrefill ?? undefined} /></label><label>Address to pay if the bounty pays out<input name="contributor" pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" /></label><p>This address is published with the book's metadata. A fresh wallet address is fine.</p></fieldset>}<button type="submit" disabled={busy || !uploadEnabled}>Submit for review</button></form>{scanReport && <section aria-label="Scan report"><h3>Scan report: {scanReport.verdict}</h3><table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>{(scanReport.checks ?? []).map(check => <tr key={check.id}><th scope="row">{check.id}</th><td>{check.passed ? 'Pass' : check.severity === 'reject' ? 'Reject' : 'Review'}</td><td>{check.detail}</td></tr>)}</tbody></table></section>}{duplicateId && <p><a href={`#/book/${duplicateId}`}>Open existing book #{duplicateId}</a></p>}
      </> : route === '/curate' ? <><h2>Curate submissions</h2><p>Curators approve or reject books after reviewing the scan report and public-domain sources.</p><button type="button" disabled={busy || !client} onClick={connectCurator}>Connect curator wallet</button>{isCurator && <><p>{pending.length} pending books</p>{pending.map(item => <PendingCard key={item.id} item={item} report={reports[item.id]} reportUrl={reportUrl} busy={busy} onDownload={() => downloadBook(item, true)} onReview={reviewBook} />)}</>}{bountiesEnabled && <BountyCurationPanel deployment={bountyDeployment} rpcUrls={bountyRpcUrls} />}</> : route === '/donate' ? (
        fundEnabled ? (
          <DonatePage
            fundAddress={fundDeployment?.address}
            deployBlock={fundDeployment?.deployBlock}
            rpcUrls={location.hostname.endsWith('.onion') ? rpcConfig.onion : rpcConfig.clearnet}
          />
        ) : (
          <section className="fund-section">
            <h2>Donate to Alexandria</h2>
            <div className="fund-banner">
              <p><strong>Feature disabled for hackathon preview.</strong></p>
              <p>The donation and paid node system is fully implemented and tested. To enable it, append <code>?fund=1</code> to the URL or set <code>ENABLE_FUND = true</code> in <code>apps/reader/src/main.tsx</code>.</p>
              <p><a href="#/">Return to catalog</a></p>
            </div>
          </section>
        )
      ) : route === '/nodes' ? (
        fundEnabled ? (
          <NodesPage
            fundAddress={fundDeployment?.address}
            deployBlock={fundDeployment?.deployBlock}
            rpcUrls={location.hostname.endsWith('.onion') ? rpcConfig.onion : rpcConfig.clearnet}
          />
        ) : (
          <section className="fund-section">
            <h2>Node Operators</h2>
            <div className="fund-banner">
              <p><strong>Feature disabled for hackathon preview.</strong></p>
              <p>The donation and paid node system is fully implemented and tested. To enable it, append <code>?fund=1</code> to the URL or set <code>ENABLE_FUND = true</code> in <code>apps/reader/src/main.tsx</code>.</p>
              <p><a href="#/">Return to catalog</a></p>
            </div>
          </section>
        )
      ) : route === '/bounties' || route.startsWith('/bounties/') ? (
        bountiesEnabled
          ? <BountiesPage deployment={bountyDeployment} rpcUrls={bountyRpcUrls} gateway={reportGateway} route={route}
              onAnswer={id => { setBountyPrefill(id); location.hash = '#/upload'; }} />
          : <section><h2>Book bounties</h2><p>Bounties open soon.</p></section>
      ) : route === '/about' ? <><h2>About Alexandria</h2><p>A library of banned books in the public domain, named after the Library of Alexandria.</p><p>Reading and downloading do not require an account or wallet. PDFs are checked against their on-chain SHA-256 hash before saving.</p><p>The registry uses Avalanche Fuji testnet; files use IPFS. {onionUrl && <>Onion mirror: <a href={onionUrl}>{onionUrl}</a>.</>}</p>{fundEnabled && <><h3>Trust model</h3><p>The host signer is one checker run by the team. Every report is public on IPFS, its CID is on chain, and anyone can re-run the checks. The Safe can replace the attester. Sybil nodes behind different hostnames on the same machine aren't fully stopped; that's a documented limit.</p></>}<p>Unaudited · Fuji testnet only.</p></> : <><h2>Page not found</h2><a href="#/">Return to catalog</a></>}
      {message && <p role="status">{message}{submissionTx && <> <a href={`https://testnet.snowtrace.io/tx/${submissionTx}`}>View submission on Snowtrace</a></>}</p>}
    </main><footer><div className="ascii-rule" aria-hidden="true">{'='.repeat(180)}</div><div className="footer-grid"><p>ALEXANDRIA<br /><span>A home for words that would not disappear.</span></p><p>PUBLIC DOMAIN / OPEN ACCESS<br />Unaudited · Fuji testnet only</p></div><p className="footer-colophon">SET IN CHARACTERS. HELD IN COMMON. <span aria-hidden="true">[ EOF ]</span></p></footer>
  </>;
}
render(<App />, document.getElementById('app')!);
