import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Keypair,VersionedTransaction,TransactionMessage} from '@solana/web3.js';
import {createRequire} from 'node:module';
import BN from 'bn.js';
import {feeClaimDay,runFeeClaimDay,buildFeeClaim,MAX_CLAIM_FEE} from '../server/automation-claim-core.js';
import {startFeeClaimScheduler} from '../server/automation-claim-scheduler.js';
const sdk=createRequire(import.meta.url)('@pump-fun/pump-sdk');
function fixture(){
 const rows=new Map(),root=Keypair.generate();let sends=0;
 const f={root,now:()=>new Date('2026-10-29T01:00:00Z'),store:{claimRecent:async()=>[...rows.values()].map(r=>structuredClone(r)),claimGet:async day=>rows.get(day)&&structuredClone(rows.get(day)),claimSave:async(day,wallet,row)=>rows.set(day,structuredClone(row))},connection:{getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',sendRawTransaction:async()=>{sends++;},getSignatureStatuses:async()=>({value:[{confirmationStatus:'finalized',err:null}]}),getBlockHeight:async()=>200,getTransaction:async()=>null},build:async()=>({state:'signed',raw:Buffer.from('approved').toString('base64'),signature:'signature',lastValidBlockHeight:300}),rows,sends:()=>sends};return f;
}
test('daily claims follow Singapore 09:00 boundary and scheduler catches up once per day',()=>{
 assert.equal(feeClaimDay(new Date('2026-10-29T00:59:59Z')).due,false);assert.deepEqual(feeClaimDay(new Date('2026-10-29T01:00:00Z')),{date:'2026-10-29',due:true});
 let tick,time=new Date('2026-10-29T01:00:00Z'),count=0,child;
 const stop=startFeeClaimScheduler({env:{AUTOCLAIM_ENABLED:'true'},now:()=>time,launch:()=>{count++;child=new EventEmitter();child.kill=()=>{};return child;},every:fn=>{tick=fn;return {};},cancel:()=>{}});
 assert.equal(count,1);tick();assert.equal(count,1);child.emit('exit',0);tick();assert.equal(count,1);time=new Date('2026-10-30T01:00:00Z');tick();assert.equal(count,2);stop();tick();assert.equal(count,2);
});
test('confirmed daily claim survives restarts and never submits again that day',async()=>{
 const f=fixture();assert.equal(await runFeeClaimDay(f),'pending');assert.equal(await runFeeClaimDay(f),'confirmed');assert.equal(await runFeeClaimDay(f),'confirmed');assert.equal(f.sends(),1);
});
test('journal failure prevents claim broadcast; no-fee days never broadcast',async()=>{
 let f=fixture();f.store.claimSave=async()=>{throw Error('journal unavailable');};await assert.rejects(runFeeClaimDay(f),/journal unavailable/);assert.equal(f.sends(),0);
 f=fixture();f.build=async()=>({state:'skipped',reason:'no-fees'});assert.equal(await runFeeClaimDay(f),'skipped');assert.equal(f.sends(),0);
});
test('unresolved older claim blocks another claim and never gets rebroadcast on a later date',async()=>{
 const f=fixture();f.rows.set('2026-10-28',{day:'2026-10-28',wallet:f.root.publicKey.toBase58(),state:'pending',signature:'old',lastValidBlockHeight:300});f.connection.getSignatureStatuses=async()=>({value:[null]});assert.equal(await runFeeClaimDay(f),'pending');assert.equal(f.sends(),0);assert.equal(f.rows.has('2026-10-29'),false);
});
test('expired claim with a transaction in history cannot be replaced',async()=>{
 const f=fixture();f.rows.set('2026-10-29',{day:'2026-10-29',wallet:f.root.publicKey.toBase58(),state:'expired',signature:'old',lastValidBlockHeight:100});f.connection.getSignatureStatuses=async()=>({value:[null]});f.connection.getTransaction=async()=>({meta:{err:null}});await assert.rejects(runFeeClaimDay(f),/EXPIRED_CLAIM_REQUIRES_RECONCILIATION/);assert.equal(f.sends(),0);
});
test('claim builder pays only the automation owner and enforces the network fee ceiling',async()=>{
 const root=Keypair.generate();const ix=await sdk.PUMP_SDK.offlinePumpProgram.methods.collectCreatorFee().accountsPartial({creator:root.publicKey}).instruction();let fee=5000;
 const connection={getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:300}),getFeeForMessage:async()=>({value:fee}),getBalance:async()=>1000000000,getMinimumBalanceForRentExemption:async()=>0,simulateTransaction:async()=>({value:{err:null}})};
 const pump={...sdk,online:{getCreatorVaultBalanceBothPrograms:async()=>new BN(10_000_000),getCreatorVaultBalance:async()=>new BN(10_000_000),collectCoinCreatorFeeInstructions:async()=>[ix]}};
 const record=await buildFeeClaim({connection,root,pump});const tx=VersionedTransaction.deserialize(Buffer.from(record.raw,'base64'));
 assert.equal(tx.message.header.numRequiredSignatures,1);assert.equal(tx.message.staticAccountKeys[0].toBase58(),root.publicKey.toBase58());const instructions=TransactionMessage.decompile(tx.message).instructions;assert.equal(instructions.length,2);assert.equal(instructions[1].programId.toBase58(),sdk.PUMP_PROGRAM_ID.toBase58());assert.equal(record.fee,5000);
 fee=MAX_CLAIM_FEE+1;await assert.rejects(buildFeeClaim({connection,root,pump}),/CLAIM_FEE_EXCEEDS_CAP/);
});
