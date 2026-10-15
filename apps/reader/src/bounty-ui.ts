// Pure helpers for the bounty pages (I9), kept apart so they can be unit tested.
import type { Bounty } from '@alexandria/sdk';

const WEI = 10n ** 18n;

/** "0.5" -> 500000000000000000n; null for anything that isn't a plain positive decimal with <= 18 places. */
export function parseAvax(text: string): bigint | null {
  const value = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(value)) return null;
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * WEI + BigInt(frac.padEnd(18, '0'));
}

/** 1500000000000000000n -> "1.5 AVAX" (up to 4 decimals, trailing zeros dropped). */
export function formatAvax(wei: bigint): string {
  const whole = wei / WEI;
  const frac = (wei % WEI).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} AVAX`;
}

export function shortAddress(address: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export interface BountyStatus {
  label: string;
  canFund: boolean;
  canRefund: boolean;
  inWindow: boolean; // a payout is proposed and its dispute window is still running
  windowLeft: number; // seconds
}

export function bountyStatus(b: Bounty, now: number): BountyStatus {
  const expired = now >= b.deadline;
  const windowLeft = b.state === 'proposed' ? Math.max(0, b.executableAt - now) : 0;
  switch (b.state) {
    case 'open':
      return expired
        ? { label: 'Expired: funders can claim refunds', canFund: false, canRefund: true, inWindow: false, windowLeft }
        : { label: 'Open: waiting for an upload', canFund: true, canRefund: false, inWindow: false, windowLeft };
    case 'proposed':
      return windowLeft > 0
        ? { label: `Payout proposed: dispute window ${formatCountdown(windowLeft)} left`, canFund: !expired, canRefund: false, inWindow: true, windowLeft }
        : { label: 'Payout ready: paid once the curator has approved the book', canFund: !expired, canRefund: false, inWindow: false, windowLeft };
    case 'paid':
      return { label: 'Paid', canFund: false, canRefund: false, inWindow: false, windowLeft };
    case 'cancelled':
      return { label: 'Cancelled: funders can claim refunds', canFund: false, canRefund: true, inWindow: false, windowLeft };
    default:
      return { label: 'Unknown', canFund: false, canRefund: false, inWindow: false, windowLeft };
  }
}

/** The library's public-domain rule (README section 10), checked before a bounty is posted. */
export function publicDomainProblem(firstPublished: number, deathYears: number[]): string | null {
  if (!Number.isInteger(firstPublished)) return 'Enter the year the book was first published.';
  if (firstPublished > 1930) return 'Only books first published in 1930 or earlier can have a bounty.';
  if (!deathYears.length || deathYears.some((y) => !Number.isInteger(y))) return 'Enter the death year of every author and translator.';
  if (deathYears.some((y) => y > 1955)) return 'Every author and translator must have died by 1955.';
  return null;
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
