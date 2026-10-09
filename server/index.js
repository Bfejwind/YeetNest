import express from 'express';
import { createApi } from './api.js';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const directory = resolve(process.env.DATA_DIR || 'data');
await mkdir(directory, { recursive: true });
await access(directory, constants.R_OK | constants.W_OK);
const app = express();
let stopping = false;
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.get('/healthz', (req, res) => res.status(stopping ? 503 : 200).json({ status: stopping ? 'stopping' : 'ok' }));
const api = createApi({ config: { ...process.env, LOCAL_SETUP_ENABLED: 'false' }, storageDir: directory });
await api.locals.ready();
app.get('/readyz', async (req, res) => {
  try {
    if (stopping) throw new Error('Stopping');
    await api.locals.ready();
    await access(directory, constants.R_OK | constants.W_OK);
    res.json({ ready: true, scope: 'process-and-application-storage' });
  } catch { res.status(503).json({ ready: false, scope: 'process-and-application-storage' }); }
});
app.use(api);
app.use(express.static('dist'));
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`MemePop is running at http://localhost:${port}`);
});
function shutdown() {
  if (stopping) return;
  stopping = true;
  api.locals.stopStreams();
  server.close(async error => {
    try { await api.locals.close(); process.exitCode = error ? 1 : 0; }
    catch { process.exitCode = 1; }
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
