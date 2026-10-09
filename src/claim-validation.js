import { validateComputeBudget } from './launch-validation.js';

export function validateCreatorClaim(transaction, keys, { owner, program, accounts, recipient }) {
  const message = transaction.message;
  if (message.staticAccountKeys[0].toBase58() !== owner || message.header.numRequiredSignatures !== 1) throw new Error('Unexpected claim payer or signer.');
  validateComputeBudget(message.compiledInstructions, keys);
  let claims = 0;
  for (const instruction of message.compiledInstructions) {
    const id = keys.get(instruction.programIdIndex)?.toBase58();
    if (id === 'ComputeBudget111111111111111111111111111111') continue;
    const addresses = Array.from(instruction.accountKeyIndexes, index => keys.get(index)?.toBase58());
    if (id === program) {
      claims++;
      if (instruction.data.length !== 8 || ![26, 97, 138, 203, 132, 171, 141, 252].every((value, index) => instruction.data[index] === value)
        || addresses.length !== accounts.length || addresses.some((address, index) => address !== accounts[index])) throw new Error('Creator claim instruction or destination changed.');
    } else if (id === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
      const expected = [owner, recipient, owner, accounts[4], '11111111111111111111111111111111', accounts[5]];
      if (instruction.data.length !== 1 || instruction.data[0] !== 1 || addresses.length !== 6 || addresses.some((address, index) => address !== expected[index])) throw new Error('Unexpected claim token account creation.');
    } else throw new Error('Unexpected instruction in creator claim.');
  }
  if (claims !== 1) throw new Error('Expected exactly one creator claim.');
}
