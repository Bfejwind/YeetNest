const hosts = new Set(['ipfs.io', 'dweb.link', 'gateway.pinata.cloud', 'arweave.net']);
const failure = message => Object.assign(new Error(message), { status: 502 });

export function metadataUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw failure('Unsupported metadata URL.');
  const normalized = value.startsWith('ipfs://') ? `https://gateway.pinata.cloud/ipfs/${value.slice(7).replace(/^ipfs\//, '')}` : value;
  const url = new URL(normalized);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname) || (url.hostname !== 'arweave.net' && !url.pathname.startsWith('/ipfs/'))) throw failure('Unsupported metadata gateway.');
  url.hash = '';
  return url.href;
}

export function createTokenMetadata({ fetcher = fetch, now = Date.now, capacity = 500, concurrency = 4 } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid metadata service limits.');
  const cache = new Map(), pending = new Map();
  return async uri => {
    const url = metadataUrl(uri);
    const hit = cache.get(url);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(url)) return pending.get(url);
    if (pending.size >= concurrency) throw Object.assign(new Error('Metadata service is busy. Try again.'), { status: 503 });
    const task = (async () => {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok || !response.body) throw failure('Metadata provider is unavailable.');
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 65536) throw failure('Metadata exceeds 64 KB.');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('Invalid token metadata.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('Invalid token metadata.');
      const value = { description: typeof data.description === 'string' ? data.description.slice(0, 500) : '', image: null };
      if (data.image) { try { value.image = metadataUrl(data.image); } catch {} }
      cache.delete(url);
      while (cache.size >= capacity) cache.delete(cache.keys().next().value);
      cache.set(url, { value, expires: now() + 900000 });
      return value;
    })();
    pending.set(url, task);
    try { return await task; }
    catch (error) { if (error.status) throw error; throw failure('Metadata provider is unavailable.'); }
    finally { pending.delete(url); }
  };
}
