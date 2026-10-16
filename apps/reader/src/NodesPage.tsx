import { useEffect, useState } from 'preact/hooks';
import {
  createFundClient,
  type OperatorInfo,
  type EpochClosedEvent,
  type StorageSpentEvent,
  AlexandriaError,
  type FundWalletClient,
} from '@alexandria/sdk';

interface NodesPageProps {
  fundAddress?: `0x${string}`;
  deployBlock?: number;
  rpcUrls: string[];
}

export function NodesPage(props: NodesPageProps) {
  if (!props.fundAddress) {
    return (
      <section className="nodes-page">
        <h2>Node Operators</h2>
        <p>Donations open soon</p>
      </section>
    );
  }
  return <NodesPageLive {...props} fundAddress={props.fundAddress} />;
}

function NodesPageLive({ fundAddress, deployBlock, rpcUrls }: NodesPageProps & { fundAddress: `0x${string}` }) {
  const [client] = useState(() =>
    createFundClient({
      contract: fundAddress,
      deployBlock: deployBlock ?? 0,
      rpcUrls,
    })
  );

  const [operators, setOperators] = useState<OperatorInfo[]>([]);
  const [epochs, setEpochs] = useState<EpochClosedEvent[]>([]);
  const [storageSpends, setStorageSpends] = useState<StorageSpentEvent[]>([]);
  const [gatewayInput, setGatewayInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Operator wallet state
  const [wallet, setWallet] = useState<FundWalletClient | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<`0x${string}` | null>(null);
  const [owedBalance, setOwedBalance] = useState<bigint | null>(null);

  useEffect(() => {
    let active = true;

    async function loadNodeData() {
      try {
        const ops = await client.getOperators();
        if (active) setOperators(ops);
      } catch {}

      try {
        const eps = await client.getEpochs({ limit: 5 });
        if (active) setEpochs(eps);
      } catch {}

      try {
        const spends = await client.getStorageSpends({ limit: 10 });
        if (active) setStorageSpends(spends);
      } catch {}
    }

    loadNodeData();
    const interval = setInterval(loadNodeData, 20000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [client]);

  async function connectOperatorWallet() {
    setStatusMsg('');
    setBusy(true);
    try {
      const w = await client.connectFundWallet();
      setWallet(w);
      const accounts = (await (globalThis as any).ethereum?.request({ method: 'eth_accounts' })) as `0x${string}`[];
      if (accounts && accounts[0]) {
        setConnectedAddress(accounts[0]);
        const owed = await client.owed(accounts[0]);
        setOwedBalance(owed);
      }
      setStatusMsg('Wallet connected.');
    } catch (err: unknown) {
      if (err instanceof AlexandriaError) {
        if (err.code === 'NO_WALLET') {
          setStatusMsg('No wallet connected. Please install Core or MetaMask.');
        } else if (err.code === 'WRONG_CHAIN') {
          setStatusMsg('Wrong network. Please switch to Avalanche Fuji Testnet.');
        } else {
          setStatusMsg(`Wallet error: ${err.message}`);
        }
      } else {
        setStatusMsg('Wallet connection failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: Event) {
    e.preventDefault();
    setStatusMsg('');

    const gw = gatewayInput.trim();
    if (!gw.startsWith('http://') && !gw.startsWith('https://')) {
      setStatusMsg('Gateway URL must start with http:// or https://');
      return;
    }
    if (gw.length < 10 || gw.length > 200) {
      setStatusMsg('Gateway URL must be between 10 and 200 characters.');
      return;
    }

    setBusy(true);
    setStatusMsg('Registering node on-chain…');

    try {
      const w = wallet ?? (await client.connectFundWallet());
      setWallet(w);
      const hash = await w.registerOperator(gw);
      setStatusMsg(`Node successfully registered! (tx: ${hash.slice(0, 10)}…)`);
      setGatewayInput('');

      const ops = await client.getOperators();
      setOperators(ops);
    } catch (err: unknown) {
      if (err instanceof AlexandriaError) {
        if (err.message === 'GatewayTaken') {
          setStatusMsg('This gateway is already registered.');
        } else if (err.message === 'AlreadyRegistered') {
          setStatusMsg('This wallet has already registered a node.');
        } else if (err.message === 'BadGateway') {
          setStatusMsg('Invalid gateway URL.');
        } else if (err.message === 'TooManyOperators') {
          setStatusMsg('Maximum operator limit reached.');
        } else {
          setStatusMsg(`Registration failed: ${err.message}`);
        }
      } else {
        setStatusMsg('Registration failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim() {
    if (!wallet) return;
    setStatusMsg('');
    setBusy(true);

    try {
      const hash = await wallet.claim();
      setStatusMsg(`Payout claimed! (tx: ${hash.slice(0, 10)}…)`);
      if (connectedAddress) {
        const owed = await client.owed(connectedAddress);
        setOwedBalance(owed);
      }
    } catch (err: unknown) {
      if (err instanceof AlexandriaError) {
        if (err.message === 'NothingToClaim') {
          setStatusMsg('Nothing to claim.');
        } else {
          setStatusMsg(`Claim failed: ${err.message}`);
        }
      } else {
        setStatusMsg('Claim failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function formatAvax(wei: bigint): string {
    const whole = wei / 1000000000000000000n;
    const remainder = wei % 1000000000000000000n;
    const frac = remainder.toString().padStart(18, '0').slice(0, 4);
    return `${whole}.${frac} AVAX`;
  }

  return (
    <section className="nodes-page" aria-labelledby="nodes-title">
      <h2 id="nodes-title">Node Operators</h2>
      <p>
        Alexandria nodes pin all approved public-domain books and serve them through public IPFS
        gateways (Tor onion services and HTTPS). At the end of every epoch, 50% of all library
        donations are distributed equally to active nodes.
      </p>

      <div style={{ margin: '16px 0' }}>
        <a href="https://github.com/TommyTheSecond/Alexandria" target="_blank" rel="noreferrer" style={{ fontWeight: 'bold' }}>
          [ RUN A NODE & SETUP GUIDE --&gt; ]
        </a>
      </div>

      <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '32px', margin: '24px 0' }}>
        <div>
          <h3>Operator Payouts & Claim</h3>
          {!wallet ? (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
                Connect your operator wallet to check your accrued share from past epochs and claim payouts.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={connectOperatorWallet}
                style={{
                  padding: '8px 16px',
                  border: '1px solid var(--ink)',
                  fontWeight: 'bold',
                }}
              >
                [ CONNECT OPERATOR WALLET ]
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '13px' }}>
                Connected:{' '}
                <span style={{ fontFamily: 'monospace' }}>
                  {connectedAddress?.slice(0, 8)}…{connectedAddress?.slice(-6)}
                </span>
              </p>
              <p style={{ fontSize: '15px' }}>
                Unclaimed earnings:{' '}
                <strong>{owedBalance !== null ? formatAvax(owedBalance) : 'Loading…'}</strong>
              </p>
              <button
                type="button"
                disabled={busy || owedBalance === 0n}
                onClick={handleClaim}
                style={{
                  padding: '8px 16px',
                  border: '1px solid var(--ink)',
                  fontWeight: 'bold',
                }}
              >
                {busy ? 'Claiming…' : '[ CLAIM PAYOUT ]'}
              </button>
            </div>
          )}

          {statusMsg && (
            <p role="status" style={{ marginTop: '14px' }}>
              {statusMsg}
            </p>
          )}

          <div style={{ marginTop: '32px' }}>
            <h3>Register a New Node</h3>
            <form onSubmit={handleRegister}>
              <label>
                Gateway URL (Tor .onion or HTTPS)
                <input
                  type="text"
                  required
                  placeholder="http://...onion or https://..."
                  value={gatewayInput}
                  onInput={(e) => setGatewayInput((e.target as HTMLInputElement).value)}
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                style={{
                  marginTop: '10px',
                  padding: '8px 16px',
                  border: '1px solid var(--ink)',
                  fontWeight: 'bold',
                }}
              >
                [ REGISTER NODE ]
              </button>
            </form>
          </div>
        </div>

        <div style={{ borderLeft: '1px dashed var(--rule)', paddingLeft: '24px' }}>
          <h3>Recent Epoch History</h3>
          {epochs.length === 0 ? (
            <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No epochs closed yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, fontSize: '13px' }}>
              {epochs.map((ep, i) => (
                <li key={i} style={{ marginBottom: '12px', borderBottom: '1px dashed var(--rule)', paddingBottom: '8px' }}>
                  <strong>Epoch #{ep.epoch.toString()}</strong>
                  <br />
                  Active nodes: {ep.activeCount.toString()} · Share:{' '}
                  {formatAvax(ep.sharePerOperator)}
                  <br />
                  <span style={{ color: 'var(--ink-soft)', fontSize: '11px' }}>
                    Report CID: {ep.reportCid ? `${ep.reportCid.slice(0, 16)}…` : 'none'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>

      <h3>Registered Nodes ({operators.length})</h3>
      {operators.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)' }}>No node operators registered yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>Operator</th>
              <th style={{ padding: '8px 4px' }}>Gateway</th>
              <th style={{ padding: '8px 4px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {operators.map((op, i) => (
              <tr key={i} style={{ borderBottom: '1px dashed var(--rule)' }}>
                <td style={{ padding: '8px 4px', fontFamily: 'monospace' }}>
                  {op.address.slice(0, 6)}…{op.address.slice(-4)}
                </td>
                <td style={{ padding: '8px 4px' }}>
                  <a href={op.gateway} target="_blank" rel="noreferrer">
                    {op.gateway}
                  </a>
                </td>
                <td style={{ padding: '8px 4px' }}>Registered</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {storageSpends.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>
          <h3>Storage Fund Expenditures</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule)', textAlign: 'left' }}>
                <th style={{ padding: '8px 4px' }}>Recipient</th>
                <th style={{ padding: '8px 4px' }}>Amount</th>
                <th style={{ padding: '8px 4px' }}>Memo</th>
                <th style={{ padding: '8px 4px' }}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {storageSpends.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px dashed var(--rule)' }}>
                  <td style={{ padding: '8px 4px', fontFamily: 'monospace' }}>
                    {s.to.slice(0, 6)}…{s.to.slice(-4)}
                  </td>
                  <td style={{ padding: '8px 4px' }}>{formatAvax(s.amount)}</td>
                  <td style={{ padding: '8px 4px', color: 'var(--ink-soft)' }}>{s.memo}</td>
                  <td style={{ padding: '8px 4px' }}>
                    <a href={`https://testnet.snowtrace.io/tx/${s.txHash}`} target="_blank" rel="noreferrer">
                      Snowtrace
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
