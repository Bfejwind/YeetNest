import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Keypair,TransactionMessage,VersionedTransaction,SystemInstruction,SystemProgram} from '@solana/web3.js';
import {buildCreation} from '../server/automation-core.js';
const sdk=createRequire(import.meta.url)('@pump-fun/pump-sdk');
function setup() {
 const root=Keypair.generate(),payer=Keypair.generate();let calls=0;
 const connection={getAccountInfo:async()=>({owner:sdk.PUMP_PROGRAM_ID}),getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),getFeeForMessage:async message=>({value:message.header.numRequiredSignatures===3?10000:5000}),getBalance:async()=>6_400_000,simulateTransaction:async(tx,options)=>{
  calls++;
  if(calls===1)return {value:{err:{InsufficientFundsForRent:{account_index:0}}}};
  if(calls===2){assert.equal(options.sigVerify,false);assert.equal(options.replaceRecentBlockhash,true);assert.ok(tx.signatures.every(bytes=>bytes.every(byte=>byte===0)));return {value:{err:null,accounts:[{lamports:1_495_000}]}};}
  assert.equal(options.sigVerify,true);return {value:{err:null,accounts:[{lamports:0}]}};
 }};
 return {root,payer,connection,pump:{...sdk,online:{fetchGlobal:async()=>({createV2Enabled:true})}},metadata:{name:'Koala Shades',ticker:'KOALASHADE',uri:'https://example.com/koala.json'}};
}
test('final creation returns only unused daily SOL to creator; simulated headroom is never signed',async()=>{
 const f=setup(),r=await buildCreation(f.connection,f.pump,f.payer,f.root.publicKey,f.metadata,6_200_000,{refundRemainder:true});
 const tx=VersionedTransaction.deserialize(Buffer.from(r.raw,'base64')),ix=TransactionMessage.decompile(tx.message).instructions;
 assert.equal(ix.length,4);assert.equal(ix[3].programId.toBase58(),SystemProgram.programId.toBase58());const refund=SystemInstruction.decodeTransfer(ix[3]);assert.equal(refund.fromPubkey.toBase58(),f.payer.publicKey.toBase58());assert.equal(refund.toPubkey.toBase58(),f.root.publicKey.toBase58());assert.equal(refund.lamports,500000n);assert.equal(r.refundLamports,500000);assert.equal(r.reserve,5_925_000);assert.equal(tx.message.header.numRequiredSignatures,2);assert.ok(!tx.message.staticAccountKeys.slice(0,2).some(key=>key.equals(f.root.publicKey)));
});
test('ordinary creation never adds refund behavior and final refund must stay within budget',async()=>{
 let f=setup();await assert.rejects(buildCreation(f.connection,f.pump,f.payer,f.root.publicKey,f.metadata,6_200_000),/CREATION_SIMULATION_FAILED/);
 f=setup();await assert.rejects(buildCreation(f.connection,f.pump,f.payer,f.root.publicKey,f.metadata,5_900_000,{refundRemainder:true}),/DAILY_CREATION_BUDGET_EXHAUSTED/);
});
