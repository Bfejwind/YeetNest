import { TransactionMessage } from '@solana/web3.js';

export function validateLocalInstructions(transaction, instructions, owner, signers = []) {
  const message = TransactionMessage.decompile(transaction.message);
  const expectedMessage = new TransactionMessage({ payerKey: message.payerKey, recentBlockhash: message.recentBlockhash, instructions }).compileToV0Message();
  if (!Buffer.from(expectedMessage.serialize()).equals(Buffer.from(transaction.message.serialize()))) throw new Error('Pump transaction differs from the reviewed account permissions or instructions.');
  if (message.payerKey.toBase58() !== owner || message.instructions.length !== instructions.length) throw new Error('Pump transaction differs from the reviewed instructions.');
  for (let i = 0; i < instructions.length; i++) {
    const actual = message.instructions[i], expected = instructions[i];
    if (!actual.programId.equals(expected.programId) || !actual.data.equals(expected.data) || actual.keys.length !== expected.keys.length) throw new Error('Pump transaction instruction was changed.');
    for (let j = 0; j < expected.keys.length; j++) {
      if (!actual.keys[j].pubkey.equals(expected.keys[j].pubkey)) throw new Error('Pump transaction destination was changed.');
    }
  }
  const required = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map(key => key.toBase58());
  if (required.some(key => ![owner, ...signers].includes(key))) throw new Error('Pump transaction includes an unexpected signer.');
}
