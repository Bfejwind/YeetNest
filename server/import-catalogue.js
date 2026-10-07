import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import { LAUNCHPAD_PROGRAM, LaunchpadPool, getPdaLaunchpadPoolId } from '@raydium-io/raydium-sdk-v2';
import { createAppStore } from './app-store.js';

const directory = resolve(process.env.DATA_DIR || 'data');
if (!process.env.DATABASE_URL) throw new Error('Configure server-only DATABASE_URL.');
const store = createAppStore({ databaseUrl: process.env.DATABASE_URL });
try {
  await store.ready();
  const load = async filename => {
    try {
      const rows = JSON.parse(await readFile(resolve(directory, filename), 'utf8'));
      if (!Array.isArray(rows)) throw new Error('Invalid catalogue export.');
      return rows;
    } catch(error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const coins = await load('coins.json');
  const references = await load('upload-references.json');
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Mainnet RPC required.');
  for (const coin of coins) {
    const mint = new PublicKey(coin.mint), poolId = new PublicKey(coin.poolId);
    const account = await connection.getAccountInfo(poolId);
    if (!account?.owner.equals(LAUNCHPAD_PROGRAM)) throw new Error('Unverified pool in export.');
    const pool = LaunchpadPool.decode(account.data);
    if (!pool.mintA.equals(mint) || pool.creator.toBase58() !== coin.creator || !getPdaLaunchpadPoolId(LAUNCHPAD_PROGRAM, mint, pool.mintB).publicKey.equals(poolId)) throw new Error('Export does not match on-chain ownership.');
  }
  for (const entry of references) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') throw new Error('Invalid upload reference in export.');
    const wallet = new PublicKey(entry[1]?.wallet).toBase58();
    const uri = entry[1]?.uri || entry[0].slice(wallet.length + 1);
    if (entry[0] !== `${wallet}:${uri}` || !/^https:\/\//.test(uri)) throw new Error('Invalid upload reference in export.');
  }
  console.log(`Verified export: ${coins.length} coins, ${references.length} upload references. Existing database records will not be overwritten.`);
  if (process.argv.includes('--apply')) {
    await store.mutate('upload-references', rows => { for (const entry of references) if (!rows.some(([key]) => key === entry[0])) rows.push(entry); });
    await store.mutate('coins', rows => { for (const coin of coins) if (!rows.some(row => row.mint === coin.mint)) rows.push(coin); });
    console.log('Catalogue import complete.');
  } else console.log('Dry run only. Back up both sources before rerunning with --apply.');
} catch {
  console.error('Import failed. Verify export format, database schema and on-chain ownership. No secret values are logged.');
  process.exitCode = 1;
} finally { await store.close(); }
