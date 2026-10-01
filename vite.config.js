import { defineConfig } from 'vite';
import { createApi } from './server/api.js';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === 'hosted' ? [{ find: './chain.js', replacement: fileURLToPath(new URL('./src/hosted-chain.js', import.meta.url)) }] : [] },
  plugins: [{
    name: 'yeetnest-api',
    configureServer(server) {
      server.middlewares.use(createApi());
    },
  }],
  define: { global: 'globalThis' },
}));
