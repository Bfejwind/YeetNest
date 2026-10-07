export function toUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Token decimals are invalid or unavailable.');
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Enter a positive amount without exponent notation.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error(`This asset supports at most ${decimals} decimal places.`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units <= 0n || units > 18446744073709551615n) throw new Error('Amount is outside the supported range.');
  return units.toString();
}

export function fromUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Token decimals are invalid or unavailable.');
  const units = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${units / scale}${fraction ? `.${fraction}` : ''}`;
}

export function minimumOutput(raw, slippageBps) {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new Error('Slippage must be between 0.01% and 5%.');
  return (BigInt(raw) * BigInt(10000 - slippageBps) / 10000n).toString();
}
