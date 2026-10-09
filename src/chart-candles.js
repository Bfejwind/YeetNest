export function aggregateCandles(rows, interval) {
  const unique = new Map();
  for (const row of rows || []) {
    if (!Array.isArray(row) || row.length < 5 || !row.slice(0, 5).every(Number.isFinite)) continue;
    const [time, open, high, low, close, volume] = row;
    if (time <= 0 || low < 0 || low > Math.min(open, close) || high < Math.max(open, close)) continue;
    unique.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : 0 });
  }
  const buckets = new Map();
  for (const row of [...unique.values()].sort((a, b) => a.time - b.time)) {
    const time = Math.floor(row.time / interval) * interval;
    const previous = buckets.get(time);
    if (previous) {
      previous.high = Math.max(previous.high, row.high);
      previous.low = Math.min(previous.low, row.low);
      previous.close = row.close;
      previous.volume += row.volume;
    } else buckets.set(time, { ...row, time });
  }
  return [...buckets.values()];
}
