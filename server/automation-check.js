import 'dotenv/config';
import pg from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import { databaseConfig } from './database-config.js';
import { readAutomationWallet } from './automation-core.js';
let failed=false;
const report=(name,ok)=>{console.log(`${name}: ${ok?'OK':'MISSING OR UNAVAILABLE'}`);if(!ok)failed=true;};
let wallet;
try {wallet=readAutomationWallet(process.env);report('Signing key matches configured public address',true);}catch{report('Signing key matches configured public address',false);}
report('Pinata JWT configured',!!process.env.PINATA_JWT);
const client=process.env.DATABASE_URL?new pg.Client(databaseConfig(process.env.DATABASE_URL)):null;
client?.on('error',()=>{});
try {
 if(!client)throw new Error();await client.connect();
 await client.query('SELECT day FROM automation_days LIMIT 0');await client.query('SELECT artwork FROM automation_metadata LIMIT 0');
 report('Database and migration 015',true);
}catch{report('Database and migration 015',false);}finally{await client?.end().catch(()=>{});}
try {
 if(!process.env.SOLANA_RPC_URL)throw new Error();
 const connection=new Connection(process.env.SOLANA_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});
 report('Solana mainnet RPC',await connection.getGenesisHash()==='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
 if(process.env.AUTOLAUNCH_WALLET){const key=new PublicKey(process.env.AUTOLAUNCH_WALLET);console.log('Automation public address: '+key.toBase58());report('Wallet has at least 0.01 SOL',await connection.getBalance(key)>=10000000);}
}catch{report('Solana mainnet RPC/wallet balance',false);}
console.log('Activation flag: '+(process.env.AUTOLAUNCH_ENABLED==='true'?'enabled':'disabled'));
console.log('Read-only preflight: no transaction signed/sent, no upload or database mutation.');
process.exitCode=failed?1:0;
