import http from 'node:http';
import { AddressInfo } from 'node:net';

export type GatewayMode = 'ok' | 'html200' | 'truncated' | 'hang';

export interface MockGatewayServer {
  url: string;
  setMode: (mode: GatewayMode) => void;
  close: () => Promise<void>;
}

export function createMockGateway(initialMode: GatewayMode, pdfBytes: Uint8Array): Promise<MockGatewayServer> {
  return new Promise((resolve) => {
    let mode = initialMode;
    const server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (mode === 'ok') {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBytes.length.toString(),
        });
        res.end(Buffer.from(pdfBytes));
      } else if (mode === 'html200') {
        const html = '<html><body><h1>404 Not Found (HTML disguised as 200)</h1></body></html>';
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Length': Buffer.byteLength(html).toString(),
        });
        res.end(html);
      } else if (mode === 'truncated') {
        const half = Math.max(1, Math.floor(pdfBytes.length / 2));
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBytes.length.toString(), // says full length but sends half
        });
        res.write(Buffer.from(pdfBytes.slice(0, half)));
        res.destroy(); // forcibly close connection
      } else if (mode === 'hang') {
        // Do not respond; keep open
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        setMode: (newMode: GatewayMode) => {
          mode = newMode;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
