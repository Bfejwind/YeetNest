import {toUnits} from '../src/amounts.js';
import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {preparePumpCreatorClaim, pumpCreatorFeeBalance} from '../src/pump-chain.js';
import {reconcile, stop} from './automation-core.js';
export const MAX_CLAIM_FEE = 100_000;
export function feeClaimDay(now=new Date()) {
  const local=new Date(now.getTime()+8*3600000);
  return {date:local.toISOString().slice(0,10),due:local.getUTCHours()>=9};
}
export async function buildFeeClaim({connection,root,pump}) {
  const context={connection,wallet:()=>root.publicKey,pumpSdk:pump};
  const balance=await pumpCreatorFeeBalance(context);
  if (Number(balance.amount)<=0) return {state:'skipped',reason:'no-fees'};
  const built=await preparePumpCreatorClaim({...context,submit:async(transaction,record)=>{
    const fresh=await record.prepareForSigning();transaction=fresh.transaction;
    if (!(transaction instanceof VersionedTransaction) || transaction.message.header.numRequiredSignatures!==1 || !transaction.message.staticAccountKeys[0].equals(root.publicKey)) throw stop('INVALID_CLAIM_SIGNER');
    const fee=(await connection.getFeeForMessage(transaction.message,'confirmed')).value;
    const rent=Number(toUnits(built.rentReserve,9)), amount=Number(toUnits(balance.amount,9));
    if (!Number.isSafeInteger(fee)||fee<0||fee>MAX_CLAIM_FEE) throw stop('CLAIM_FEE_EXCEEDS_CAP');
    if (!Number.isSafeInteger(rent)||!Number.isSafeInteger(amount)||amount<=fee+rent) return {state:'skipped',reason:'below-fee-cost'};
    transaction.sign([root]);
    const simulation=await connection.simulateTransaction(transaction,{sigVerify:true,commitment:'confirmed'});
    if(simulation.value.err)throw stop('CLAIM_SIMULATION_FAILED');
    const validity=await connection.getLatestBlockhash('confirmed');
    transaction.message.recentBlockhash=validity.blockhash;transaction.sign([root]);
    return {state:'signed',raw:Buffer.from(transaction.serialize()).toString('base64'),signature:bs58.encode(transaction.signatures[0]),blockhash:validity.blockhash,lastValidBlockHeight:validity.lastValidBlockHeight,fee,availableLamports:amount,rentReserve:rent};
  }});
  return built.execute();
}
export async function runFeeClaimDay({store,connection,root,pump,build=buildFeeClaim,now=()=>new Date()}) {
  const day=feeClaimDay(now());if(!day.due)return 'not-due';
  if(await connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw stop('MAINNET_REQUIRED');
  const wallet=root.publicKey.toBase58();
  for(const row of await store.claimRecent(wallet)) {
    if(row.day>=day.date||['confirmed','failed','expired','skipped'].includes(row.state))continue;
    await reconcile(connection,row);await store.claimSave(row.day,wallet,row);
    if(!['confirmed','failed','expired'].includes(row.state))return 'pending';
  }
  let row=await store.claimGet(day.date,wallet);
  if(row&&row.wallet!==wallet)throw stop('CLAIM_WALLET_MISMATCH');
  if(row&&['confirmed','failed','skipped'].includes(row.state))return row.state;
  if(row?.state==='expired') {
    if(await connection.getBlockHeight('finalized')<=row.lastValidBlockHeight)return 'pending';
    const status=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value[0];
    const transaction=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if(status||transaction)throw stop('EXPIRED_CLAIM_REQUIRES_RECONCILIATION');
    const replacement=await build({connection,root,pump});
    row={...replacement,day:day.date,wallet,expiredAttempts:[...(row.expiredAttempts||[]),{...row,expiredAttempts:undefined}]};
    await store.claimSave(day.date,wallet,row);
  }
  if(!row){row={...await build({connection,root,pump}),day:day.date,wallet};await store.claimSave(day.date,wallet,row);}
  if(row.state==='skipped')return 'skipped';
  if(feeClaimDay(now()).date!==day.date)return 'date-ended';
  await reconcile(connection,row,{resend:true});await store.claimSave(day.date,wallet,row);
  return ['confirmed','failed'].includes(row.state)?row.state:'pending';
}
