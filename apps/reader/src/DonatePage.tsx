import { useEffect, useState } from 'preact/hooks';
import { createFundClient, type FundStats, type DonatedEvent, AlexandriaError } from '@alexandria/sdk';
import QRCode from 'qrcode';

interface DonatePageProps {
  fundAddress?: `0x${string}`;
  deployBlock?: number;
  rpcUrls: string[];
}

export function DonatePage({ fundAddress, deployBlock, rpcUrls }: DonatePageProps) {
  if (!fundAddress) {
    return (
      <section className="donate-page">
        <h2>Donate to Alexandria</h2>
        <p>Donations open soon</p>
      </section>
    );
  }

  const [client] = useState(() =>
    createFundClient({
      contract: fundAddress,
      deployBlock: deployBlock ?? 0,
      rpcUrls,
    })
  );

  const [stats, setStats] = useState<FundStats | null>(null);
  const [donations, setDonations] = useState<DonatedEvent[]>([]);
  const [amountStr, setAmountStr] = useState('0.1');
  const [note, setNote] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        const s = await client.getStats();
        if (active) setStats(s);
      } catch {
        // stats load failure handled gracefully
      }

      try {
        const d = await client.getDonations({ limit: 10 });
        if (active) setDonations(d);
      } catch {
        // donations load failure handled gracefully
      }
    }

    loadData();
    const interval = setInterval(loadData, 20000);

    // Generate QR code for plain transfer
    QRCode.toDataURL(fundAddress, { margin: 1, width: 160 })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [client, fundAddress]);

  const numAmount = parseFloat(amountStr) || 0;
  const operatorSplit = (numAmount * 0.5).toFixed(4);
  const storageSplit = (numAmount * 0.5).toFixed(4);

  async function handleDonate(e: Event) {
    e.preventDefault();
    setStatusMsg('');
    setTxHash(null);

    const val = parseFloat(amountStr);
    if (isNaN(val) || val < 0.001) {
      setStatusMsg('Minimum donation is 0.001 AVAX.');
      return;
    }

    const noteBytes = new TextEncoder().encode(note);
    if (noteBytes.length > 140) {
      setStatusMsg('Note must be 140 bytes or fewer.');
      return;
    }

    setBusy(true);
    setStatusMsg('Connecting wallet and sending donation…');

    try {
      const wallet = await client.connectFundWallet();
      const amountWei = BigInt(Math.floor(val * 1e18));
      const hash = await wallet.donate(amountWei, note);

      setTxHash(hash);
      setStatusMsg(`Thank you for supporting Alexandria!`);

      // Refresh stats and donations
      const s = await client.getStats();
      setStats(s);
      const d = await client.getDonations({ limit: 10 });
      setDonations(d);
    } catch (err: unknown) {
      if (err instanceof AlexandriaError) {
        if (err.code === 'NO_WALLET') {
          setStatusMsg('No wallet connected. Please install Core or MetaMask.');
        } else if (err.code === 'WRONG_CHAIN') {
          setStatusMsg('Wrong network. Please switch to Avalanche Fuji Testnet.');
        } else if (err.message === 'DonationTooSmall') {
          setStatusMsg('Minimum donation is 0.001 AVAX.');
        } else if (err.message === 'NoteTooLong') {
          setStatusMsg('Note must be 140 bytes or fewer.');
        } else if (err.message === 'DonationsClosed') {
          setStatusMsg('Donations are currently paused.');
        } else {
          setStatusMsg(`Donation failed: ${err.message}`);
        }
      } else {
        setStatusMsg('Donation failed. Please try again.');
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
    <section className="donate-page" aria-labelledby="donate-title">
      <h2 id="donate-title">Support Alexandria</h2>
      <p>
        Alexandria is a public good preserving banned books in the public domain.
        Every donation is split automatically by smart contract: <strong>50%</strong> rewards node
        operators who pin and serve books, and <strong>50%</strong> funds permanent storage bills.
      </p>

      {stats && (
        <div className="fund-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', margin: '20px 0' }}>
          <div className="stat-card">
            <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>TOTAL DONATED</span>
            <h3 style={{ margin: '4px 0' }}>{formatAvax(stats.totalDonated)}</h3>
          </div>
          <div className="stat-card">
            <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>NODE POOL</span>
            <h3 style={{ margin: '4px 0' }}>{formatAvax(stats.operatorPool)}</h3>
          </div>
          <div className="stat-card">
            <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>STORAGE FUND</span>
            <h3 style={{ margin: '4px 0' }}>{formatAvax(stats.storageBalance)}</h3>
          </div>
        </div>
      )}

      <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '32px', margin: '24px 0' }}>
        <div>
          <h3>Donate with Web3 Wallet</h3>
          <form onSubmit={handleDonate}>
            <label>
              Amount (AVAX)
              <input
                type="number"
                step="0.001"
                min="0.001"
                required
                value={amountStr}
                onInput={(e) => setAmountStr((e.target as HTMLInputElement).value)}
              />
            </label>

            <div style={{ fontSize: '12px', color: 'var(--ink-soft)', margin: '8px 0 16px 0' }}>
              Split: <strong>{operatorSplit} AVAX</strong> to node operators · <strong>{storageSplit} AVAX</strong> to storage
            </div>

            <label>
              Note (optional, up to 140 bytes)
              <input
                type="text"
                maxLength={140}
                placeholder="In defense of free thought..."
                value={note}
                onInput={(e) => setNote((e.target as HTMLInputElement).value)}
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              style={{
                marginTop: '12px',
                padding: '10px 20px',
                border: '1px solid var(--ink)',
                fontWeight: 'bold',
              }}
            >
              {busy ? 'Processing…' : '[ DONATE WITH WALLET ]'}
            </button>
          </form>

          {statusMsg && (
            <p role="status" style={{ marginTop: '16px' }}>
              {statusMsg}
              {txHash && (
                <> · <a href={`https://testnet.snowtrace.io/tx/${txHash}`} target="_blank" rel="noreferrer">View on Snowtrace</a></>
              )}
            </p>
          )}
        </div>

        <div style={{ borderLeft: '1px dashed var(--rule)', paddingLeft: '24px' }}>
          <h3>Plain Transfer (Tor / Direct)</h3>
          <p style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
            For Tor Browser or wallets without web extensions: send test AVAX directly to the contract address.
            The contract automatically splits plain transfers 50/50.
          </p>
          <p style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '12px' }}>
            <strong>{fundAddress}</strong>
          </p>
          {qrDataUrl && (
            <figure style={{ margin: '16px 0' }}>
              <img src={qrDataUrl} alt={`QR code for ${fundAddress}`} width={160} height={160} />
              <figcaption style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>Contract Address QR</figcaption>
            </figure>
          )}
        </div>
      </div>

      <div className="ascii-rule" aria-hidden="true">{'-'.repeat(180)}</div>

      <h3>Recent Donations</h3>
      {donations.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)' }}>No donations recorded yet. Be the first to support Alexandria!</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginTop: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule)', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>Donor</th>
              <th style={{ padding: '8px 4px' }}>Amount</th>
              <th style={{ padding: '8px 4px' }}>Note</th>
              <th style={{ padding: '8px 4px' }}>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {donations.map((d, i) => (
              <tr key={i} style={{ borderBottom: '1px dashed var(--rule)' }}>
                <td style={{ padding: '8px 4px', fontFamily: 'monospace' }}>
                  {d.donor.slice(0, 6)}…{d.donor.slice(-4)}
                </td>
                <td style={{ padding: '8px 4px' }}>{formatAvax(d.amount)}</td>
                <td style={{ padding: '8px 4px', color: 'var(--ink-soft)' }}>{d.note || '—'}</td>
                <td style={{ padding: '8px 4px' }}>
                  <a href={`https://testnet.snowtrace.io/tx/${d.txHash}`} target="_blank" rel="noreferrer">
                    Snowtrace
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
