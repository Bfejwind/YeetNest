export function artworkGateways(value) {
  try {
    let path;
    if (value.startsWith('ipfs://')) path = value.slice(7).replace(/^ipfs\//, '');
    else {
      const url = new URL(value);
      if (url.protocol !== 'https:') return [];
      if (url.pathname.startsWith('/ipfs/')) path = url.pathname.slice(6) + url.search;
      else {
        const match = url.hostname.match(/^([a-z0-9]+)\.ipfs\./i);
        if (match) path = match[1] + url.pathname + url.search;
      }
    }
    if (!path || !/^[a-zA-Z0-9]+(?:[/?]|$)/.test(path)) return [];
    return ['https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/', 'https://ipfs.io/ipfs/'].map(base => base + path).filter(url => url !== value);
  } catch { return []; }
}
