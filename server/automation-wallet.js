import { mkdir, writeFile } from 'node:fs/promises';
import { Keypair } from '@solana/web3.js';
// This directory is ignored by Git. Never print the signing secret.
try {
  await mkdir('data',{recursive:true});
  const wallet=Keypair.generate();
  await writeFile('data/automation-wallet.json',JSON.stringify([...wallet.secretKey]),{flag:'wx',mode:0o600});
  console.log(`Dedicated automation wallet public address: ${wallet.publicKey.toBase58()}`);
  console.log('Secret saved privately to data/automation-wallet.json. Existing wallet files are never overwritten.');
} catch(error) {
  console.error(error.code==='EEXIST'?'Automation wallet file already exists; kept unchanged.':'Unable to create private automation wallet file.');
  process.exitCode=1;
}
