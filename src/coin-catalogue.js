export function isRealCoin(coin) {
  return Boolean(coin && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin.mint || '') &&
    !coin.demo && !coin.simulated && !/demo|sample|simulated/i.test(coin.source || ''));
}

export function mergeCoin(previous, next) {
  const coin = { ...previous, ...next };
  if (!next.image && previous?.image) coin.image = previous.image;
  return coin;
}
