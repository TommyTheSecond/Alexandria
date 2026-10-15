import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DailyCap } from './cap.js';
import { ChainFailure, type ChainGateway, type RelayInput, type RelayResult } from './chain.js';

interface Options {
  secret: string;
  gateway: ChainGateway;
  dailyLimit?: number;
  now?: () => number;
  onSubmitted?: (result: RelayResult) => void;
}

const CID = /^baf[a-z2-7]{20,97}$/;
const HASH = /^0x[0-9a-f]{64}$/;

function authenticated(header: string | string[] | undefined, expected: Buffer): boolean {
  if (typeof header !== 'string') return false;
  const provided = Buffer.from(header);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function parseInput(request: IncomingMessage): Promise<RelayInput | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) return null;
    chunks.push(bytes);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 3 || typeof fields.pdfCid !== 'string' || !CID.test(fields.pdfCid) ||
    typeof fields.metaCid !== 'string' || !CID.test(fields.metaCid) ||
    typeof fields.pdfSha256 !== 'string' || !HASH.test(fields.pdfSha256) || /^0x0{64}$/.test(fields.pdfSha256)) return null;
  return fields as unknown as RelayInput;
}

export function createRelayerServer(options: Options): Server {
  if (!options.secret) throw new Error('RELAY_SECRET is required');
  const secret = Buffer.from(options.secret);
  const cap = new DailyCap(options.dailyLimit, options.now);
  let tail: Promise<unknown> = Promise.resolve();

  const server = createServer(async (request, response) => {
    if (!authenticated(request.headers['x-relay-secret'], secret)) {
      respond(response, 401, { code: 'UNAUTHORIZED' });
      return;
    }
    try {
      if (request.method === 'GET' && request.url === '/health') {
        respond(response, 200, { ok: true, address: options.gateway.address,
          balanceWei: (await options.gateway.getBalance()).toString(), sentToday: cap.sentToday });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/relay') {
        respond(response, 404, { code: 'NOT_FOUND' });
        return;
      }
      const input = await parseInput(request);
      if (!input) { respond(response, 400, { code: 'INVALID_INPUT' }); return; }
      const job = tail.then(async () => {
        const existingId = await options.gateway.existingId(input.pdfSha256);
        if (existingId !== 0) { respond(response, 409, { code: 'DUPLICATE', existingId }); return; }
        if (cap.isFull) { respond(response, 429, { code: 'DAILY_CAP' }); return; }
        const result = await options.gateway.submit(input);
        cap.recordSuccess();
        respond(response, 200, result);
        options.onSubmitted?.(result);
      });
      tail = job.catch(() => undefined);
      await job;
    } catch (error) {
      if (error instanceof ChainFailure && error.duplicateId !== undefined) {
        respond(response, 409, { code: 'DUPLICATE', existingId: error.duplicateId });
        return;
      }
      respond(response, 502, { code: 'CHAIN_ERROR', detail: error instanceof ChainFailure ? error.detail : 'Chain request failed' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export async function listenLoopback(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => { server.off('error', onError); resolve(); });
  });
}
