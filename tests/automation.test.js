import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Keypair, PublicKey, SystemInstruction, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { DAILY_CAP, DAILY_ALLOWANCE, FUNDING_FEE_RESERVE, readAutomationWallet, dailyWallet, buildFunding, buildCreation, reconcile, runAutomationDay, recoverAutomationDays } from '../server/automation-core.js';
const sdk=createRequire(import.meta.url)('@pump-fun/pump-sdk');
function fixture({cost=1_000_000,fee=5000}={}) {
 const root=Keypair.generate(), payer=dailyWallet(root,'2026-10-27'), records=new Map(), balances=new Map([[root.publicKey.toBase58(),100_000_000],[payer.publicKey.toBase58(),0]]), statuses=new Map(), sends=[];
 const store={get:async day=>records.has(day)?structuredClone(records.get(day)):null,save:async(day,value)=>records.set(day,structuredClone(value))};
 const connection={
  getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  getSignaturesForAddress:async()=>[],
  getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),
  getFeeForMessage:async()=>({value:fee}),getBalance:async key=>balances.get(key.toBase58())||0,
  getAccountInfo:async()=>({owner:sdk.PUMP_PROGRAM_ID}),getBlockHeight:async()=>50,getTransaction:async()=>null,
  simulateTransaction:async(tx,options)=>({value:{err:null,accounts:options.accounts?[{lamports:(balances.get(payer.publicKey.toBase58())||0)-cost}]:undefined}}),
  getSignatureStatuses:async signatures=>({value:signatures.map(s=>statuses.get(s)||null)}),
  sendRawTransaction:async raw=>{
   const tx=VersionedTransaction.deserialize(raw), message=TransactionMessage.decompile(tx.message), signature=bs58.encode(tx.signatures[0]);sends.push({raw:Buffer.from(raw).toString('base64'),tx,message});
   if(!statuses.has(signature)) {
    if(message.instructions[0].programId.equals(SystemProgram.programId)) {
     const transfer=SystemInstruction.decodeTransfer(message.instructions[0]);balances.set(payer.publicKey.toBase58(),Number(transfer.lamports));
    } else {balances.set(payer.publicKey.toBase58(),balances.get(payer.publicKey.toBase58())-cost);}
    statuses.set(signature,{confirmationStatus:'finalized',err:null});
   }
   return signature;
  },
 };
 const pump={...sdk,online:{fetchGlobal:async()=>({createV2Enabled:true})}};
 const metadataFor=async template=>({...template.fields,uri:'https://gateway.pinata.cloud/ipfs/QmTestMetadataForAutomation',image:template.image});
 const registered=[];const register=async record=>registered.push(record.mint);
 return {root,payer,store,connection,pump,records,balances,statuses,sends,registered,metadataFor,register,now:()=>new Date('2026-10-27T01:15:00Z')};
}
test('wallet configuration binds public address, exact cap, and forbids token purchases',()=>{
 const key=Keypair.generate(),env={AUTOLAUNCH_SECRET_KEY:bs58.encode(key.secretKey),AUTOLAUNCH_WALLET:key.publicKey.toBase58()};
 assert.equal(readAutomationWallet(env).publicKey.toBase58(),env.AUTOLAUNCH_WALLET);
 assert.throws(()=>readAutomationWallet({...env,AUTOLAUNCH_INITIAL_BUY_SOL:'0.001'}),/PURCHASES_FORBIDDEN/);
 assert.throws(()=>readAutomationWallet({...env,AUTOLAUNCH_DAILY_BUDGET_SOL:'0.02'}),/BUDGET_MUST/);
 assert.throws(()=>readAutomationWallet({...env,AUTOLAUNCH_WALLET:Keypair.generate().publicKey.toBase58()}),/MISMATCHED/);
 assert.equal(dailyWallet(key,'2026-10-27').publicKey.toBase58(),dailyWallet(key,'2026-10-27').publicKey.toBase58());
 assert.notEqual(dailyWallet(key,'2026-10-28').publicKey.toBase58(),dailyWallet(key,'2026-10-27').publicKey.toBase58());
});
test('funding is a single fixed transfer with fees inside total 0.01 SOL and rejects topups',async()=>{
 const f=fixture(),record=await buildFunding(f.connection,f.root,f.payer),tx=VersionedTransaction.deserialize(Buffer.from(record.raw,'base64')),message=TransactionMessage.decompile(tx.message);
 assert.equal(message.instructions.length,1);const transfer=SystemInstruction.decodeTransfer(message.instructions[0]);
 assert.equal(Number(transfer.lamports),DAILY_ALLOWANCE);assert.equal(transfer.toPubkey.toBase58(),f.payer.publicKey.toBase58());assert.ok(Number(transfer.lamports)+record.fee<=DAILY_CAP);
 f.connection.getFeeForMessage=async()=>({value:FUNDING_FEE_RESERVE+1});await assert.rejects(buildFunding(f.connection,f.root,f.payer),/FEE_EXCEEDS/);
 f.balances.set(f.payer.publicKey.toBase58(),1);await assert.rejects(buildFunding(f.connection,f.root,f.payer),/ALREADY_FUNDED/);
});
test('creation signs only daily payer and mint and includes create_v2 plus bounded compute instructions, never a buy',async()=>{
 const f=fixture();f.balances.set(f.payer.publicKey.toBase58(),DAILY_ALLOWANCE);
 const metadata=await f.metadataFor({fields:{name:'Koala Shades',ticker:'KOALASHADE'},image:'/koala.png'});
 const r=await buildCreation(f.connection,f.pump,f.payer,f.root.publicKey,metadata,DAILY_ALLOWANCE);
 const tx=VersionedTransaction.deserialize(Buffer.from(r.raw,'base64')),message=TransactionMessage.decompile(tx.message);
 assert.equal(message.instructions.length,3);
 const definition=sdk.pumpIdl.instructions.find(i=>i.name.replaceAll('_','').toLowerCase()==='createv2');
 assert.ok(message.instructions[2].data.subarray(0,8).equals(Buffer.from(definition.discriminator)));
 assert.equal(tx.message.header.numRequiredSignatures,2);
 assert.ok(!tx.message.staticAccountKeys.slice(0,2).some(k=>k.equals(f.root.publicKey)));
 assert.equal(message.payerKey.toBase58(),f.payer.publicKey.toBase58());
 await assert.rejects(buildCreation(f.connection,f.pump,f.payer,f.root.publicKey,metadata,10000),/BUDGET_EXHAUSTED/);
 f.connection.simulateTransaction=async()=>({value:{err:'controlled'}});await assert.rejects(buildCreation(f.connection,f.pump,f.payer,f.root.publicKey,metadata,DAILY_ALLOWANCE),/SIMULATION_FAILED/);
 assert.equal(f.sends.length,0);
});
test('five creations survive restarts and repeated runs never fund or create twice',async()=>{
 const f=fixture();let state;
 for(let i=0;i<8;i++) state=await runAutomationDay(f);
 assert.equal(state,'done');assert.equal(f.sends.length,6);assert.equal(f.registered.length,5);
 assert.equal(f.records.get('2026-10-27').slots.length,5);
 assert.equal(new Set(f.records.get('2026-10-27').slots.map(s=>s.mint)).size,5);
 await runAutomationDay(f);assert.equal(f.sends.length,6);
});
test('rent and fee budget stops remaining launches, without increasing funding or buying',async()=>{
 const f=fixture({cost:3_000_000});let state;
 for(let i=0;i<8;i++) state=await runAutomationDay(f);
 assert.equal(state,'blocked');assert.equal(f.sends.length,4);assert.equal(f.records.get('2026-10-27').slots.length,3);
 const journal=f.records.get('2026-10-27');assert.ok(journal.slots.reduce((sum,s)=>sum+s.reserve,0)<=DAILY_ALLOWANCE);
 assert.equal(journal.initialBuy,'0');assert.equal(journal.cap,10_000_000);
});
test('failed journal write prevents broadcast',async()=>{
 const f=fixture();f.store.save=async()=>{throw new Error('database unavailable');};await assert.rejects(runAutomationDay(f),/database unavailable/);assert.equal(f.sends.length,0);
});
test('unknown submission resends identical saved bytes without replacing signature',async()=>{
 const f=fixture(),r=await buildFunding(f.connection,f.root,f.payer);
 f.connection.sendRawTransaction=async bytes=>{f.sends.push(Buffer.from(bytes).toString('base64'));throw new Error('response lost');};
 await reconcile(f.connection,r,{resend:true});await reconcile(f.connection,r,{resend:true});
 assert.deepEqual(f.sends,[r.raw,r.raw]);assert.equal(r.state,'pending');
});
test('before 09:15 or on wrong network no funds are sent',async()=>{
 const f=fixture();f.now=()=>new Date('2026-10-27T01:14:59Z');assert.equal(await runAutomationDay(f),'not-due');
 f.now=()=>new Date('2026-10-27T01:15:00Z');f.connection.getGenesisHash=async()=> 'devnet';await assert.rejects(runAutomationDay(f),/MAINNET_REQUIRED/);assert.equal(f.sends.length,0);
});

test('signed funding cannot be broadcast if its durable journal write fails',async()=>{
 const f=fixture(),save=f.store.save;
 f.store.save=async(day,value)=>{if(value.funding?.raw)throw new Error('journal write failed');return save(day,value);};
 await assert.rejects(runAutomationDay(f),/journal write failed/);assert.equal(f.sends.length,0);
 assert.equal(f.records.get('2026-10-27').funding,undefined);
});
test('funding fails closed if a restored journal lost a previous daily wallet transaction',async()=>{
 const f=fixture();f.connection.getSignaturesForAddress=async()=>[{signature:'previous-funding'}];
 await assert.rejects(buildFunding(f.connection,f.root,f.payer),/PRIOR_HISTORY/);assert.equal(f.sends.length,0);
});

test('old confirmed launch recovery registers its listing without funding or resubmitting',async()=>{
 const f=fixture();const r=await buildFunding(f.connection,f.root,f.payer);
 f.statuses.set(r.signature,{confirmationStatus:'finalized',err:null});
 const journal={day:'2026-10-26',wallet:f.root.publicKey.toBase58(),slots:[{...r,mint:Keypair.generate().publicKey.toBase58()}]};
 f.store.recent=async()=>[journal];
 await recoverAutomationDays(f);assert.equal(f.registered.length,1);assert.equal(f.sends.length,0);
 assert.equal(f.records.get('2026-10-26').slots[0].registered,true);
});
