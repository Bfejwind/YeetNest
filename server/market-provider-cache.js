export function marketProviderCache(fetchData, { now = Date.now, ttl = 300000, capacity = 200 } = {}) {
  const cache = new Map(), pending = new Map(), cooldown = new Map();
  return async (url, options = {}) => {
    const host = new URL(url).hostname;
    if (!['api.dexscreener.com', 'api.geckoterminal.com'].includes(host) || (options.method && options.method !== 'GET')) return fetchData(url, options);
    const cached = cache.get(url);
    if (cached && cached.expires > now()) return cached.data;
    if (pending.has(url)) return pending.get(url);
    const unavailable = () => Object.assign(new Error('Chart provider rate limit reached. Please wait two minutes before retrying.'), { status: 429 });
    if ((cooldown.get(host) || 0) > now()) throw unavailable();
    const request = (async () => {
      try {
        const data = await fetchData(url, options);
        if (!cache.has(url) && cache.size >= capacity) cache.delete(cache.keys().next().value);
        cache.set(url, { data, expires: now() + ttl });
        return data;
      } catch (error) {
        if (error.status === 429) { cooldown.set(host, now() + 120000); throw unavailable(); }
        throw error;
      } finally { pending.delete(url); }
    })();
    pending.set(url, request);
    return request;
  };
}
