import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export default defineConfig({ base: './', plugins: [{
  name: 'saved-catalog',
  configureServer(server) {
    const snapshot = fileURLToPath(new URL('../../snapshots/latest.json', import.meta.url));
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/catalog.json' || !existsSync(snapshot)) return next();
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(readFileSync(snapshot));
    });
  },
}] });
