import { defineConfig } from 'vite';
import { createApi } from './server/api.js';

export default defineConfig({
  plugins: [{
    name: 'yeetnest-api',
    configureServer(server) {
      server.middlewares.use(createApi());
    },
  }],
  define: { global: 'globalThis' },
});
