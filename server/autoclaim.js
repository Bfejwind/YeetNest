import 'dotenv/config';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {Connection} from '@solana/web3.js';
import {readAutomationWallet,stop} from './automation-core.js';
import {openAutomationStore} from './automation-store.js';
import {createPilotControl} from './pilot-control.js';
import {runFeeClaimDay} from './automation-claim-core.js';
let store,control;
const shutdown=new AbortController();process.on('SIGTERM',()=>shutdown.abort());process.on('SIGINT',()=>shutdown.abort());
try {
 if(process.env.AUTOCLAIM_ENABLED!=='true'){console.log('Daily fee claims disabled.');}
 else {
  if(!process.env.DATABASE_URL||!process.env.SOLANA_RPC_URL)throw stop('CLAIM_DATABASE_AND_RPC_REQUIRED');
  store=await openAutomationStore(process.env.DATABASE_URL);await store.claimReady();
  if(!await store.acquire())throw stop('ANOTHER_AUTOMATION_WORKER_IS_ACTIVE');
  const root=readAutomationWallet(process.env);
  control=createPilotControl(process.env.DATABASE_URL);await control.ready();
  const interval=Number(process.env.RPC_SHARED_INTERVAL_MS||500);if(!Number.isInteger(interval)||interval<100||interval>60000)throw stop('INVALID_SHARED_RPC_INTERVAL');
  const connection=new Connection(process.env.SOLANA_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:control.fetch((url,options)=>fetch(url,{...options,signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(25000)])}),interval,shutdown.signal)});
  const sdk=createRequire(import.meta.url)('@pump-fun/pump-sdk'),pump={...sdk,online:new sdk.OnlinePumpSdk(connection)};
  let state='pending';
  for(let attempt=0;attempt<40&&!shutdown.signal.aborted;attempt++) {
   state=await runFeeClaimDay({store,connection,root,pump});console.log(JSON.stringify({creatorFeeClaim:state}));
   if(state!=='pending')break;await sleep(15000,undefined,{signal:shutdown.signal});
  }
  if(state==='pending')process.exitCode=1;
 }
}catch(error){if(!shutdown.signal.aborted){console.error(error.automationCode||'CLAIM_STOPPED_CHECK_CONFIGURATION_AND_RPC');process.exitCode=1;}}
finally{await Promise.allSettled([control?.close(),store?.close()]);}
