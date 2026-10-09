import 'dotenv/config';
import { createIndexerQueue } from './indexer-queue.js';

const [command = 'failed', signature] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!['failed', 'retry', 'prune'].includes(command) || (command === 'retry' && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || ''))) throw new Error('Use: npm run indexer:jobs -- failed | retry <signature> | prune');
const protocol = process.env.INDEXER_PROTOCOL || 'pump';
if (!['pump', 'raydium'].includes(protocol)) throw new Error('INDEXER_PROTOCOL must be pump or raydium.');
const queue = createIndexerQueue(process.env.DATABASE_URL, { name: protocol === 'pump' ? 'pump' : 'launchlab' });
try {
  await queue.ready();
  if (command === 'failed') console.log(JSON.stringify(await queue.failed(), null, 2));
  if (command === 'retry') {
    if (!await queue.retry(signature)) throw new Error('Failed job not found. Only failed jobs can be retried.');
    console.log('Failed job requeued.');
  }
  if (command === 'prune') console.log(`Removed ${await queue.prune()} completed jobs older than seven days.`);
} finally { await queue.close(); }
