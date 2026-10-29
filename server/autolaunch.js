import 'dotenv/config';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { Connection, PublicKey } from '@solana/web3.js';
import { openAutomationStore } from './automation-store.js';
import { runAutomationDay, recoverAutomationDays, readAutomationWallet, stop } from './automation-core.js';
import { createAutomationMetadata } from './automation-metadata.js';
import { createCatalogueStore } from './catalogue-store.js';
import { createPilotControl } from './pilot-control.js';
import { verifyPumpLaunch } from './pump-protocol.js';

let store, catalogue, control;
const shutdown = new AbortController();
process.on('SIGTERM',()=>shutdown.abort()); process.on('SIGINT',()=>shutdown.abort());
try {
  const statusOnly = process.argv.includes('--status');
  if (!statusOnly && process.env.AUTOLAUNCH_ENABLED !== 'true') {
    console.log('Automation disabled. No wallet loaded, upload made, or transaction sent.');
  } else {
    if (!process.env.DATABASE_URL) throw stop('AUTOMATION_DATABASE_REQUIRED');
    store = await openAutomationStore(process.env.DATABASE_URL); await store.ready();
    if (statusOnly) console.log(JSON.stringify(await store.summary(),null,2));
    else {
      if (!await store.acquire()) throw stop('ANOTHER_AUTOMATION_WORKER_IS_ACTIVE');
      const root = readAutomationWallet(process.env);
      if (!process.env.SOLANA_RPC_URL || !process.env.PINATA_JWT) throw stop('AUTOMATION_RPC_AND_PINATA_REQUIRED');
      control=createPilotControl(process.env.DATABASE_URL);await control.ready();
      const interval=Number(process.env.RPC_SHARED_INTERVAL_MS || 500);
      if (!Number.isInteger(interval)||interval<100||interval>60000) throw stop('INVALID_SHARED_RPC_INTERVAL');
      const fetcher=control.fetch((url,options)=>fetch(url,{...options,signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(25000)])}),interval,shutdown.signal);
      const connection=new Connection(process.env.SOLANA_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:fetcher});
      const sdk=createRequire(import.meta.url)('@pump-fun/pump-sdk');
      const pump={...sdk,online:new sdk.OnlinePumpSdk(connection)};
      catalogue=createCatalogueStore({databaseUrl:process.env.DATABASE_URL});await catalogue.ready();
      const metadataFor=createAutomationMetadata(store,{jwt:process.env.PINATA_JWT});
      const register=async(record,creator)=>{
        const account=await connection.getAccountInfo(new PublicKey(record.poolId),'finalized');
        await verifyPumpLaunch(connection,{mint:record.mint,poolId:record.poolId,creator},account);
        await catalogue.upload(record.metadata);
        await catalogue.insert({id:record.mint,mint:record.mint,poolId:record.poolId,creator,name:record.metadata.name,ticker:record.metadata.ticker,description:record.metadata.description,image:record.metadata.image,socials:record.metadata.socials,uri:record.metadata.uri,pair:'SOL',created:Date.now(),source:'Pump/PumpSwap',protocol:'pump',decimals:6});
      };
      if (await connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw stop('MAINNET_REQUIRED');
      await recoverAutomationDays({store,connection,root,register});
      for(let attempt=0;attempt<40&&!shutdown.signal.aborted;attempt++) {
        const state=await runAutomationDay({store,connection,root,pump,metadataFor,register});
        console.log(JSON.stringify({automation:state,dailyCapSol:'0.02',initialBuySol:'0'}));
        if(state!=='pending') break;
        await sleep(15000,undefined,{signal:shutdown.signal});
      }
    }
  }
} catch(error) {
  // Never log raw RPC/provider errors, URLs, env contents, or the signing secret.
  if (!shutdown.signal.aborted) { console.error(error.automationCode || 'AUTOMATION_STOPPED_CHECK_DATABASE_RPC_AND_CONFIGURATION'); process.exitCode=1; }
} finally {
  await Promise.allSettled([catalogue?.close(),control?.close(),store?.close()]);
}
