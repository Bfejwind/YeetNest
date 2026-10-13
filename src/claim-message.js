import { VersionedMessage } from '@solana/web3.js';
import { Buffer } from 'buffer';

export function claimBlockhashOnlyChange(original, signedMessage) {
  const reviewed = VersionedMessage.deserialize(original);
  if (reviewed.recentBlockhash === signedMessage.recentBlockhash) return false;
  reviewed.recentBlockhash = signedMessage.recentBlockhash;
  return Buffer.from(reviewed.serialize()).equals(Buffer.from(signedMessage.serialize()));
}
