// Book bounties (I9): #/bounties, #/bounties/<id>, and the curator's payout panel on #/curate.
// Self-contained: no fund code, and the rest of the reader works the same when bounties are not deployed.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  AlexandriaError, createBountyClient,
  type AlexandriaBountyClient, type Bounty, type BountyEvent, type BountyWalletClient,
} from '@alexandria/sdk';
import { bountyStatus, formatAvax, parseAvax, publicDomainProblem, shortAddress, utf8Length } from './bounty-ui';

export interface BountyDeployment { address: `0x${string}`; deployBlock?: number }

const MIN_BOUNTY = 2n * 10n ** 16n; // 0.02 AVAX, contract MIN_BOUNTY
const txUrl = (hash: string) => `https://testnet.snowtrace.io/tx/${hash}`;
const CID_RE = /^baf[a-z2-7]{20,97}$/;

function explain(error: unknown, fallback: string): string {
  if (!(error instanceof AlexandriaError)) return fallback;
  if (error.code === 'NO_WALLET') return 'No wallet found. Install Core or MetaMask, then try again.';
  if (error.code === 'WRONG_CHAIN') return 'Please switch your wallet to the Avalanche Fuji testnet.';
  const reasons: Record<string, string> = {
    BountyTooSmall: 'A bounty needs at least 0.02 AVAX.',
    BadText: 'One of the fields is too long or empty.',
    BadDeadline: 'The deadline must be between 1 hour and 90 days from now.',
    DeadlinePassed: 'This bounty has passed its deadline.',
    NotOpen: 'This bounty is not open for that right now.',
    NotProposed: 'There is no payout to cancel.',
    NotAuthorized: 'Only a curator or the team Safe can cancel a payout.',
    NothingToClaim: 'Nothing to claim for this wallet.',
    NothingToRefund: 'This wallet has nothing to refund on this bounty.',
    ZeroValue: 'Enter an amount.',
  };
  return reasons[error.message] ?? `${fallback} (${error.message})`;
}

function useNow(tick = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), tick);
    return () => clearInterval(timer);
  }, [tick]);
  return now;
}

function useWallet(client: AlexandriaBountyClient) {
  const [wallet, setWallet] = useState<BountyWalletClient | null>(null);
  async function connect(): Promise<BountyWalletClient> {
    if (wallet) return wallet;
    const w = await client.connectBountyWallet();
    setWallet(w);
    return w;
  }
  return { wallet, connect };
}

interface Props {
  deployment: BountyDeployment | null;
  rpcUrls: string[];
  gateway: string;
  route: string; // "/bounties" or "/bounties/<id>"
  onAnswer: (id: number) => void; // pre-fills the upload form
}

export function BountiesPage(props: Props) {
  if (!props.deployment) {
    return <section className="bounties"><h2>Book bounties</h2><p>Bounties open soon.</p></section>;
  }
  return <BountiesLive {...props} deployment={props.deployment} />;
}

function BountiesLive({ deployment, rpcUrls, gateway, route, onAnswer }: Props & { deployment: BountyDeployment }) {
  const client = useMemo(() => createBountyClient({ contract: deployment.address, deployBlock: deployment.deployBlock ?? 0, rpcUrls }),
    [deployment.address, deployment.deployBlock, rpcUrls.join(',')]);
  const id = Number(route.split('/')[2]);
  return Number.isSafeInteger(id) && id > 0
    ? <BountyDetail client={client} id={id} gateway={gateway} onAnswer={onAnswer} />
    : <BountyIndex client={client} />;
}

function BountyIndex({ client }: { client: AlexandriaBountyClient }) {
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const [error, setError] = useState('');
  const now = useNow(30000);
  useEffect(() => {
    let active = true;
    const load = () => client.listBounties({ limit: 50 })
      .then(list => { if (active) { setBounties(list); setError(''); } })
      .catch(() => { if (active) setError('Bounties could not be loaded right now. Please try again later.'); });
    load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [client]);
  return <section className="bounties">
    <h2>Book bounties</h2>
    <p>Put test AVAX on a banned public-domain book the library doesn't have yet. Whoever uploads it gets paid once
      a curator verifies the upload is the requested book, approves it, and a 10-minute dispute window has passed:
      95 % to the uploader, 5 % to the library fund. If nobody delivers before the deadline, every funder gets their money back.</p>
    {error && <p role="status">{error}</p>}
    {!bounties && !error && <p role="status">Loading bounties…</p>}
    {bounties && !bounties.length && <p>No bounties yet. Post the first one below.</p>}
    {bounties && bounties.length > 0 && <table>
      <thead><tr><th>#</th><th>Book</th><th>Reward</th><th>Deadline</th><th>Status</th></tr></thead>
      <tbody>{bounties.map(b => <tr key={b.id}>
        <td>{b.id}</td>
        <td><a href={`#/bounties/${b.id}`}>{b.title}</a> · {b.author}{b.notes ? ` · ${b.notes}` : ''}</td>
        <td>{b.state === 'paid' ? 'paid' : formatAvax(b.amount)}</td>
        <td>{new Date(b.deadline * 1000).toLocaleDateString()}</td>
        <td>{bountyStatus(b, now).label}</td>
      </tr>)}</tbody>
    </table>}
    <CreateBounty client={client} />
  </section>;
}

function CreateBounty({ client }: { client: AlexandriaBountyClient }) {
  const { connect } = useWallet(client);
  const [message, setMessage] = useState('');
  const [tx, setTx] = useState<{ hash: string; id: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setTx(null);
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const value = (name: string) => String(values.get(name) ?? '').trim();
    const title = value('title'), author = value('author'), language = value('language').toLowerCase(), notes = value('notes');
    const deaths = value('deaths').split(/[,\s]+/).filter(Boolean).map(Number);
    const problem = publicDomainProblem(Number(value('year')), deaths);
    if (problem) return setMessage(problem);
    if (!title || utf8Length(title) > 200) return setMessage('The title must be 1–200 bytes.');
    if (!author || utf8Length(author) > 120) return setMessage('The author must be 1–120 bytes.');
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(language)) return setMessage('Use a language code such as "en" or "zh".');
    if (utf8Length(notes) > 280) return setMessage('Notes must be 280 bytes or fewer.');
    const days = Number(value('days'));
    if (!Number.isInteger(days) || days < 1 || days > 90) return setMessage('The deadline must be 1–90 days.');
    const amountWei = parseAvax(value('amount'));
    if (amountWei === null || amountWei < MIN_BOUNTY) return setMessage('A bounty needs at least 0.02 AVAX.');
    setBusy(true);
    setMessage('Waiting for your wallet…');
    try {
      const wallet = await connect();
      const result = await wallet.createBounty({
        title, author, language, notes, amountWei, deadline: Math.floor(Date.now() / 1000) + days * 86400,
      });
      setTx({ hash: result.txHash, id: result.id });
      setMessage(`Bounty #${result.id} is open.`);
    } catch (error) {
      setMessage(explain(error, 'The bounty could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return <form className="bounty-form" onSubmit={submit}>
    <h3>Post a bounty</h3>
    <p>Only public-domain books: first published in 1930 or earlier, every author and translator dead by 1955.</p>
    <label>Title<input name="title" required maxLength={200} /></label>
    <label>Author<input name="author" required maxLength={120} /></label>
    <label>Language code<input name="language" required defaultValue="en" /></label>
    <label>Edition or translator (optional)<input name="notes" maxLength={280} /></label>
    <label>First published (year)<input name="year" type="number" required max="1930" /></label>
    <label>Death years of every author and translator (comma-separated)<input name="deaths" required /></label>
    <label>Deadline (days from now)<input name="days" type="number" min="1" max="90" defaultValue="30" required /></label>
    <label>Reward (AVAX, at least 0.02)<input name="amount" inputMode="decimal" defaultValue="0.1" required /></label>
    <button type="submit" disabled={busy}>Connect wallet and post bounty</button>
    {message && <p role="status">{message}{tx && <> <a href={`#/bounties/${tx.id}`}>Open bounty #{tx.id}</a> · <a href={txUrl(tx.hash)}>View on Snowtrace</a></>}</p>}
  </form>;
}

function BountyDetail({ client, id, gateway, onAnswer }: { client: AlexandriaBountyClient; id: number; gateway: string; onAnswer: (id: number) => void }) {
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [timeline, setTimeline] = useState<BountyEvent[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<{ claimable: bigint; contribution: bigint } | null>(null);
  const { wallet, connect } = useWallet(client);
  const now = useNow();

  async function load() {
    try {
      setBounty(await client.getBounty(id));
      setError('');
    } catch (e) {
      setError(e instanceof AlexandriaError && e.code === 'UNKNOWN_BOOK' ? `There is no bounty #${id}.` : 'This bounty could not be loaded right now.');
      return;
    }
    client.getTimeline(id).then(setTimeline).catch(() => setTimeline([]));
  }
  useEffect(() => { load(); const timer = setInterval(load, 20000); return () => clearInterval(timer); }, [client, id]);
  useEffect(() => {
    if (!wallet) return;
    Promise.all([client.claimable(wallet.account), client.contributionOf(id, wallet.account)])
      .then(([claimable, contribution]) => setMine({ claimable, contribution })).catch(() => setMine(null));
  }, [wallet, bounty]);

  async function act(label: string, run: (w: BountyWalletClient) => Promise<string>) {
    setBusy(true); setTxHash(''); setMessage('Waiting for your wallet…');
    try {
      const hash = await run(await connect());
      setTxHash(hash); setMessage(`${label} done.`);
      await load();
    } catch (e) {
      setMessage(explain(e, `${label} failed.`));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <section className="bounties"><a href="#/bounties">All bounties</a><p role="status">{error}</p></section>;
  if (!bounty) return <section className="bounties"><a href="#/bounties">All bounties</a><p role="status">Loading bounty…</p></section>;
  const status = bountyStatus(bounty, now);
  const verdictUrl = CID_RE.test(bounty.verdictCid) ? `${gateway}/ipfs/${bounty.verdictCid}` : '';

  return <section className="bounties">
    <a href="#/bounties">All bounties</a>
    <h2>Bounty #{bounty.id}: {bounty.title}</h2>
    <p>{bounty.author} · language {bounty.language}{bounty.notes ? ` · ${bounty.notes}` : ''}</p>
    <p><strong>{status.label}</strong></p>
    <p>Reward: {bounty.state === 'paid' ? 'paid out' : formatAvax(bounty.amount)} · deadline {new Date(bounty.deadline * 1000).toLocaleString()} · posted by {shortAddress(bounty.requester)}</p>
    {bounty.bookId > 0 && <p>Proposed book: <a href={`#/book/${bounty.bookId}`}>#{bounty.bookId}</a> · payee {shortAddress(bounty.payee)}
      {verdictUrl && <> · <a href={verdictUrl} target="_blank" rel="noopener noreferrer">Scan report & verification</a></>}</p>}

    {bounty.state === 'open' && !status.canRefund && <p><button type="button" onClick={() => onAnswer(bounty.id)}>I have this book: upload it for bounty #{bounty.id}</button></p>}

    {status.canFund && <form onSubmit={(e) => {
      e.preventDefault();
      const amount = parseAvax(String(new FormData(e.currentTarget as HTMLFormElement).get('add') ?? ''));
      if (!amount) return setMessage('Enter an amount in AVAX.');
      act('Adding funds', w => w.addFunds(bounty.id, amount));
    }}><label>Add to the reward (AVAX)<input name="add" inputMode="decimal" defaultValue="0.05" /></label><button type="submit" disabled={busy}>Add funds</button></form>}

    <p>
      {!wallet && <button type="button" disabled={busy} onClick={() => connect().catch(e => setMessage(explain(e, 'Wallet connection failed.')))}>Connect wallet</button>}
      {wallet && <>Connected {shortAddress(wallet.account)}{mine && <> · your payout to claim: {formatAvax(mine.claimable)} · your contribution: {formatAvax(mine.contribution)}</>}</>}
    </p>
    {status.canRefund && <button type="button" disabled={busy} onClick={() => act('Refund', w => w.claimRefund(bounty.id))}>Claim my refund</button>}
    {wallet && mine && mine.claimable > 0n && <button type="button" disabled={busy} onClick={() => act('Claim', w => w.claimPayout())}>Claim {formatAvax(mine.claimable)}</button>}
    {bounty.state === 'proposed' && <CancelPayout busy={busy} onCancel={reason => act('Cancelling the payout', w => w.cancelPayout(bounty.id, reason))} />}
    {message && <p role="status">{message}{txHash && <> <a href={txUrl(txHash)}>View on Snowtrace</a></>}</p>}

    <h3>Timeline</h3>
    {!timeline.length ? <p>No events loaded yet.</p> : <ol>{timeline.map(e => <li key={`${e.txHash}-${e.kind}-${String(e.amount)}`}>
      {describe(e)} · <a href={txUrl(e.txHash)}>tx</a>
    </li>)}</ol>}
  </section>;
}

function describe(e: BountyEvent): string {
  const who = e.account ? shortAddress(e.account) : '';
  switch (e.kind) {
    case 'created': return `Posted by ${who} with ${formatAvax(e.amount ?? 0n)}`;
    case 'funded': return `${who} added ${formatAvax(e.amount ?? 0n)}`;
    case 'proposed': return `Verified match for book #${e.bookId}; payout to ${who} proposed, dispute window until ${new Date((e.executableAt ?? 0) * 1000).toLocaleTimeString()}`;
    case 'payoutCancelled': return `Payout cancelled by ${who}${e.reason ? `: ${e.reason}` : ''}`;
    case 'paid': return `Paid ${formatAvax(e.amount ?? 0n)} to ${who}; ${formatAvax(e.fee ?? 0n)} ${e.feeSent ? 'to the library fund' : 'held for the library fund'}`;
    case 'cancelled': return `Bounty cancelled${e.reason ? `: ${e.reason}` : ''}`;
    case 'refunded': return `${formatAvax(e.amount ?? 0n)} refunded to ${who}`;
  }
}

function CancelPayout({ busy, onCancel }: { busy: boolean; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return <p><label>Curators: reason to stop this payout<input value={reason} maxLength={280} onInput={e => setReason(e.currentTarget.value)} /></label>
    <button type="button" disabled={busy || !reason.trim()} onClick={() => onCancel(reason.trim())}>Cancel payout</button></p>;
}

/** On #/curate: every bounty whose payout is waiting, so a curator can stop a wrong one in time. */
export function BountyCurationPanel({ deployment, rpcUrls }: { deployment: BountyDeployment | null; rpcUrls: string[] }) {
  if (!deployment) return null;
  return <BountyCurationLive deployment={deployment} rpcUrls={rpcUrls} />;
}

function BountyCurationLive({ deployment, rpcUrls }: { deployment: BountyDeployment; rpcUrls: string[] }) {
  const client = useMemo(() => createBountyClient({ contract: deployment.address, deployBlock: deployment.deployBlock ?? 0, rpcUrls }),
    [deployment.address, rpcUrls.join(',')]);
  const [proposed, setProposed] = useState<Bounty[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { connect } = useWallet(client);
  const now = useNow();
  const load = () => client.listBounties({ limit: 50 }).then(list => setProposed(list.filter(b => b.state === 'proposed'))).catch(() => {});
  useEffect(() => { load(); const timer = setInterval(load, 20000); return () => clearInterval(timer); }, [client]);
  if (!proposed.length) return null;
  return <section className="bounty-payouts">
    <h3>Bounty payouts waiting ({proposed.length})</h3>
    <p>Each payout below goes out automatically after its dispute window, once its book is approved. Cancel it if the upload is not the requested book.</p>
    <ul>{proposed.map(b => <li key={b.id}>
      <a href={`#/bounties/${b.id}`}>Bounty #{b.id}: {b.title}</a> → book <a href={`#/book/${b.bookId}`}>#{b.bookId}</a> · {formatAvax(b.amount)} to {shortAddress(b.payee)} · {bountyStatus(b, now).label}
      <CancelPayout busy={busy} onCancel={async reason => {
        setBusy(true); setMessage('Waiting for your wallet…');
        try {
          const wallet = await connect();
          const hash = await wallet.cancelPayout(b.id, reason);
          setMessage(`Payout for bounty #${b.id} cancelled. ${txUrl(hash)}`);
          await load();
        } catch (e) {
          setMessage(explain(e, 'The payout could not be cancelled.'));
        } finally {
          setBusy(false);
        }
      }} />
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
  </section>;
}
