import { describe, expect, it } from 'vitest';
import type { Bounty } from '@alexandria/sdk';
import { bountyStatus, formatAvax, formatCountdown, parseAvax, publicDomainProblem, shortAddress, utf8Length } from './bounty-ui';

const base: Bounty = {
  id: 1, requester: `0x${'1'.repeat(40)}`, createdAt: 1000, deadline: 5000, state: 'open', amount: 10n ** 18n,
  bookId: 0, payee: `0x${'0'.repeat(40)}`, executableAt: 0, title: 'Candide', author: 'Voltaire', language: 'en',
  notes: '', verdictCid: '',
};

describe('parseAvax / formatAvax', () => {
  it('round-trips plain decimals', () => {
    expect(parseAvax('0.02')).toBe(2n * 10n ** 16n);
    expect(parseAvax('1')).toBe(10n ** 18n);
    expect(parseAvax(' 1.5 ')).toBe(15n * 10n ** 17n);
    expect(formatAvax(15n * 10n ** 17n)).toBe('1.5 AVAX');
    expect(formatAvax(10n ** 18n)).toBe('1 AVAX');
    expect(formatAvax(95n * 10n ** 16n)).toBe('0.95 AVAX');
  });

  it('rejects anything else', () => {
    for (const bad of ['', '-1', '1e18', 'abc', '0.1234567890123456789', '1,5', '.5']) expect(parseAvax(bad)).toBeNull();
  });
});

describe('bountyStatus', () => {
  it('open, then expired with refunds', () => {
    expect(bountyStatus(base, 2000)).toMatchObject({ canFund: true, canRefund: false });
    expect(bountyStatus(base, 5000)).toMatchObject({ canFund: false, canRefund: true });
  });

  it('proposed shows the dispute window', () => {
    const proposed = { ...base, state: 'proposed' as const, executableAt: 2600 };
    expect(bountyStatus(proposed, 2000)).toMatchObject({ inWindow: true, windowLeft: 600, canRefund: false });
    expect(bountyStatus(proposed, 2000).label).toContain('10:00');
    expect(bountyStatus(proposed, 2600)).toMatchObject({ inWindow: false, windowLeft: 0 });
  });

  it('paid and cancelled', () => {
    expect(bountyStatus({ ...base, state: 'paid' }, 2000)).toMatchObject({ canFund: false, canRefund: false });
    expect(bountyStatus({ ...base, state: 'cancelled' }, 2000)).toMatchObject({ canRefund: true });
  });
});

describe('helpers', () => {
  it('formats countdowns and addresses', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(3725)).toBe('1:02:05');
    expect(shortAddress(`0x${'ab'.repeat(20)}`)).toBe('0xabab…abab');
  });

  it('applies the public-domain rule', () => {
    expect(publicDomainProblem(1759, [1778, 1771])).toBeNull();
    expect(publicDomainProblem(1931, [1900])).toContain('1930');
    expect(publicDomainProblem(1920, [1960])).toContain('1955');
    expect(publicDomainProblem(1920, [])).toContain('death year');
    expect(publicDomainProblem(Number.NaN, [1900])).toContain('first published');
  });

  it('counts UTF-8 bytes like the contract', () => {
    expect(utf8Length('Candide')).toBe(7);
    expect(utf8Length('紅樓夢')).toBe(9);
  });
});
