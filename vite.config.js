import { defineConfig } from 'vite';
import { createApi } from './server/api.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === 'hosted' ? [{ find: './chain.js', replacement: fileURLToPath(new URL('./src/hosted-chain.js', import.meta.url)) }] : [] },
  plugins: [{
    name: 'yeetnest-roadmap',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'launchpad-roadmap.txt', source: readFileSync(new URL('./PUMP_PARITY.md', import.meta.url), 'utf8') });
    },
  }, {
    name: 'yeetnest-api',
    configureServer(server) {
      server.middlewares.use(createApi());
    },
  }],
  define: { global: 'globalThis' },
}));
