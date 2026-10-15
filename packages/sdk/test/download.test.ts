import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '../src/client.js';
import { createMockGateway, MockGatewayServer } from './mockGateway.js';
import type { Book, ClientConfig } from '../src/types.js';

// Precompute sha256
async function sha256Hex(bytes: Uint8Array): Promise<`0x${string}`> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return ('0x' + Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase()) as `0x${string}`;
}

describe('downloadPdf', () => {
  const samplePdfBytes = new TextEncoder().encode('%PDF-1.4\n%test pdf content for testing verified download race');
  let validSha256: `0x${string}`;
  let goodServer: MockGatewayServer;
  let htmlServer: MockGatewayServer;
  let truncServer: MockGatewayServer;

  beforeAll(async () => {
    validSha256 = await sha256Hex(samplePdfBytes);
    goodServer = await createMockGateway('ok', samplePdfBytes);
    htmlServer = await createMockGateway('html200', samplePdfBytes);
    truncServer = await createMockGateway('truncated', samplePdfBytes);
  });

  afterAll(async () => {
    await goodServer.close();
    await htmlServer.close();
    await truncServer.close();
  });

  function makeBook(sha: `0x${string}`): Book {
    return {
      id: 1,
      status: 'approved',
      flags: 0,
      confirmed: true,
      submitter: '0x0000000000000000000000000000000000000000',
      submittedAt: 1000,
      pdfCid: 'bafytestcid',
      metaCid: 'bafytestmeta',
      pdfSha256: sha,
      meta: null,
    };
  }

  it('download_verifies_and_returns_blob', async () => {
    const config: ClientConfig = {
      rpcUrls: [],
      gateways: [goodServer.url],
      apiBase: '',
      contract: '0x0000000000000000000000000000000000000000',
      snapshotUrls: [],
      deployBlock: 0,
    };
    const client = createClient(config);
    const book = makeBook(validSha256);

    const blob = await client.downloadPdf(book);
    expect(blob).toBeInstanceOf(Blob);
    const arrayBuffer = await blob.arrayBuffer();
    const downloadedBytes = new Uint8Array(arrayBuffer);
    expect(downloadedBytes).toEqual(samplePdfBytes);
  });

  it('download_html200_falls_back_to_next_gateway', async () => {
    // Gateway 0 returns HTML 200; gateway 1 returns valid PDF
    const config: ClientConfig = {
      rpcUrls: [],
      gateways: [htmlServer.url, goodServer.url],
      apiBase: '',
      contract: '0x0000000000000000000000000000000000000000',
      snapshotUrls: [],
      deployBlock: 0,
    };
    const client = createClient(config);
    const book = makeBook(validSha256);

    const blob = await client.downloadPdf(book);
    expect(blob).toBeInstanceOf(Blob);
    const arrayBuffer = await blob.arrayBuffer();
    expect(new Uint8Array(arrayBuffer)).toEqual(samplePdfBytes);
  });

  it('download_truncated_rejected', async () => {
    // Gateway 0 truncates; gateway 1 returns valid PDF
    const config: ClientConfig = {
      rpcUrls: [],
      gateways: [truncServer.url, goodServer.url],
      apiBase: '',
      contract: '0x0000000000000000000000000000000000000000',
      snapshotUrls: [],
      deployBlock: 0,
    };
    const client = createClient(config);
    const book = makeBook(validSha256);

    const blob = await client.downloadPdf(book);
    expect(blob).toBeInstanceOf(Blob);
    const arrayBuffer = await blob.arrayBuffer();
    expect(new Uint8Array(arrayBuffer)).toEqual(samplePdfBytes);
  });

  it('download_all_bad_throws_INTEGRITY', async () => {
    // Only bad gateways that return bytes that don't match sha256
    const config: ClientConfig = {
      rpcUrls: [],
      gateways: [htmlServer.url],
      apiBase: '',
      contract: '0x0000000000000000000000000000000000000000',
      snapshotUrls: [],
      deployBlock: 0,
    };
    const client = createClient(config);
    const book = makeBook(validSha256);

    await expect(client.downloadPdf(book)).rejects.toMatchObject({
      code: 'INTEGRITY',
    });
  });

  it('download_none_reachable_throws_UNREACHABLE', async () => {
    // Gateways that are not running / port closed
    const config: ClientConfig = {
      rpcUrls: [],
      gateways: ['http://127.0.0.1:59999'],
      apiBase: '',
      contract: '0x0000000000000000000000000000000000000000',
      snapshotUrls: [],
      deployBlock: 0,
      gatewayTimeoutMs: 1000,
    };
    const client = createClient(config);
    const book = makeBook(validSha256);

    await expect(client.downloadPdf(book)).rejects.toMatchObject({
      code: 'UNREACHABLE',
    });
  });

  it('download_reports_progress', async () => {
    const config: ClientConfig = {
      rpcUrls: [],
      gateways: [goodServer.url],
      apiBase: '',
      contract: '0x0000000000000000000000000000000000000000',
      snapshotUrls: [],
      deployBlock: 0,
    };
    const client = createClient(config);
    const book = makeBook(validSha256);

    const progressReports: number[] = [];
    await client.downloadPdf(book, {
      onProgress: (bytes) => {
        progressReports.push(bytes);
      },
    });

    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[progressReports.length - 1]).toBe(samplePdfBytes.length);
  });

  it('download_abort_signal_cancels', async () => {
    const hangServer = await createMockGateway('hang', samplePdfBytes);
    try {
      const config: ClientConfig = {
        rpcUrls: [],
        gateways: [hangServer.url],
        apiBase: '',
        contract: '0x0000000000000000000000000000000000000000',
        snapshotUrls: [],
        deployBlock: 0,
      };
      const client = createClient(config);
      const book = makeBook(validSha256);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      await expect(client.downloadPdf(book, { signal: controller.signal })).rejects.toThrow();
    } finally {
      await hangServer.close();
    }
  });
});
