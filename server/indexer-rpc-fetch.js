import { setTimeout as delay } from 'node:timers/promises';

export function pacedRpcFetch({ fetcher = fetch, interval = 1000, signal, now = Date.now, sleep = delay } = {}) {
  let next = 0, queue = Promise.resolve();
  return async (url, options) => {
    const turn = queue.then(async () => {
      if (signal?.aborted) throw signal.reason;
      while (next > now()) await sleep(next - now(), undefined, { signal });
      next = now() + interval;
    });
    queue = turn.catch(() => {});
    await turn;
    const response = await fetcher(url, options);
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      const seconds = header ? Number(header) : NaN;
      const wait = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - now() : 30000;
      next = Math.max(next, now() + Math.max(10000, Math.min(300000, Number.isFinite(wait) ? wait : 30000)));
    }
    return response;
  };
}
