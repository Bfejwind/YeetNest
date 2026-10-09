export function createRateSampler(index, { fetcher = fetch, now = Date.now } = {}) {
  let lastAttempt = 0;
  return async () => {
    if (now() - lastAttempt < 60000) return;
    lastAttempt = now();
    const response = await fetcher('https://api.coinbase.com/v2/prices/SOL-USD/spot', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('SOL/USD rate provider unavailable.');
    const { data } = await response.json();
    if (data?.currency !== 'USD' || !/^[0-9]+(\.[0-9]+)?$/.test(data.amount) || Number(data.amount) <= 0 || !Number.isFinite(Number(data.amount))) throw new Error('Invalid SOL/USD rate.');
    await index.saveExchangeRate({ time: Math.floor(now() / 60000) * 60, usd: data.amount, source: 'Coinbase SOL-USD spot, observed minute snapshot' });
  };
}
