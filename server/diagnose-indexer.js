import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import { indexPumpTransaction } from './pump-indexer.js';
import { indexPumpSwapTransaction } from './pumpswap-indexer.js';
import { indexerErrorCode } from './indexer-error.js';
import { pacedRpcFetch } from './indexer-rpc-fetch.js';

const signature = process.argv[2];
if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || '') || !process.env.SOLANA_RPC_URL) throw new Error('Provide a transaction signature and configure SOLANA_RPC_URL privately.');
const connection = new Connection(process.env.SOLANA_RPC_URL, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: pacedRpcFetch({ interval: 2000, fetcher: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) }) });
let launches = 0, trades = 0;
const index = { saveLaunch: async () => { launches++; }, saveTrade: async () => { trades++; } };
try {
  const transaction = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 1, commitment: 'finalized' });
  if (!transaction) throw new Error('Finalized transaction not available');
  const row = { signature, slot: transaction.slot, blockTime: transaction.blockTime };
  await indexPumpTransaction({ transaction, row, connection, index });
  await indexPumpSwapTransaction({ transaction, row, connection, index });
  console.log(JSON.stringify({ result: 'decoded', launches, trades, readOnly: true }));
} catch (error) {
  const message = String(error.message).replace(/https?:\/\/\S+/g, '[provider URL]').replace(/[a-zA-Z0-9_-]{32,}/g, '[redacted]').slice(0, 400);
  console.log(JSON.stringify({ result: 'failed', code: indexerErrorCode(error), type: error.name, message, readOnly: true }));
  process.exitCode = 1;
}
