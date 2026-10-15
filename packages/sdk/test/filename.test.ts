import { describe, it, expect } from 'vitest';
import { createClient } from '../src/client.js';
import type { Book, ClientConfig } from '../src/types.js';

const dummyConfig: ClientConfig = {
  rpcUrls: ['http://127.0.0.1:8545'],
  gateways: ['http://127.0.0.1:8080'],
  apiBase: 'http://127.0.0.1:8000',
  contract: '0x1111111111111111111111111111111111111111',
  snapshotUrls: ['./catalog.json'],
  deployBlock: 0,
};

describe('pdfFileName', () => {
  const client = createClient(dummyConfig);

  function makeBook(id: number, title: string, authors: { name: string; deathYear: number | null }[]): Book {
    return {
      id,
      status: 'approved',
      flags: 0,
      confirmed: true,
      submitter: '0x0000000000000000000000000000000000000000',
      submittedAt: 1000,
      pdfCid: 'bafytest',
      metaCid: 'bafytestmeta',
      pdfSha256: '0x0000000000000000000000000000000000000000000000000000000000000000',
      meta: {
        schemaVersion: '1.0.0',
        title,
        authors,
        translators: [],
        firstPublishedYear: 1818,
        language: 'en',
        description: 'Test book',
        publicDomain: { sourceName: 'Gutenberg', sourceUrl: 'https://gutenberg.org' },
        bans: [{ country: 'US', authority: 'Postal', year: 1900, scope: 'postal', sourceUrl: 'https://example.com' }],
        pdf: { cid: 'bafytest', sha256: '0x0000000000000000000000000000000000000000000000000000000000000000', bytes: 1000, pages: 10 },
        submittedVia: 'web',
        scanReportCid: null,
      },
    };
  }

  it('filename_ascii_title', () => {
    const book = makeBook(1, 'Frankenstein', [{ name: 'Mary Shelley', deathYear: 1851 }]);
    const name = client.pdfFileName(book);
    expect(name).toBe('Frankenstein-Shelley.pdf');
  });

  it('filename_cjk_title_falls_back_to_book_id', () => {
    const book = makeBook(42, '红楼梦', [{ name: '曹雪芹', deathYear: 1763 }]);
    const name = client.pdfFileName(book);
    expect(name).toBe('book-42.pdf');
  });

  it('filename_cyrillic_author_falls_back_safely', () => {
    const book = makeBook(7, 'Война и мир', [{ name: 'Лев Толстой', deathYear: 1910 }]);
    const name = client.pdfFileName(book);
    expect(name).toBe('book-7.pdf');
  });
});
