import 'dotenv/config';
import { createRequire } from 'node:module';
import { Connection, PublicKey, TransactionMessage } from '@solana/web3.js';
import { preparePumpCreatorClaim } from '../src/pump-chain.js';
import { pacedRpcFetch } from './indexer-rpc-fetch.js';

const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk');
const owner = new PublicKey(process.argv[2]);
if (!process.env.SOLANA_RPC_URL) throw new Error('Configure SOLANA_RPC_URL privately.');
const connection = new Connection(process.env.SOLANA_RPC_URL, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: pacedRpcFetch({ interval: 2000, fetcher: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }) });
try {
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Expected mainnet');
  let description;
  const prepared = await preparePumpCreatorClaim({ connection, wallet: () => owner, pumpSdk: pump, submit: async transaction => {
    description = TransactionMessage.decompile(transaction.message).instructions.map(ix => ({ program: ix.programId.toBase58(), dataBytes: ix.data.length, accounts: ix.keys.length }));
    return 'READ_ONLY_NO_SIGNATURE';
  } });
  await prepared.execute();
  console.log(JSON.stringify({ readOnly: true, simulation: 'passed', amount: prepared.amount, networkFee: prepared.networkFee, rentReserve: prepared.rentReserve, instructions: description }));
} catch (error) {
  console.log(JSON.stringify({ readOnly: true, error: String(error.message).replace(/https?:\/\/\S+/g, '[provider URL]').slice(0, 400) }));
  process.exitCode = 1;
}
