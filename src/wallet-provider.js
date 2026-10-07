import { getWallets } from '@wallet-standard/app';
import { StandardWalletAdapter } from '@solana/wallet-standard-wallet-adapter-base';

const wallets = getWallets();
const supported = new Set(['Phantom', 'Solflare', 'Solflare Web']);

export async function requestWalletConnection(candidate, name, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => candidate.connect()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${name} did not finish connecting within 30 seconds. Open its extension, unlock it and approve or close any pending connection request. Then try again; reload this tab if the wallet still reports a pending request.`), { code: 'WALLET_CONNECTION_TIMEOUT' })), timeoutMs);
      }),
    ]);
  } catch(error) {
    if (error?.code === 4001) throw new Error('Wallet connection was rejected. You can try again when ready.');
    if (error?.code === -32002) throw new Error(`${name} already has a pending request. Open its extension and approve or close that request before trying again.`);
    throw error;
  } finally { clearTimeout(timer); }
}

function injected(name) {
  const candidates = name === 'Phantom'
    ? [window.phantom?.solana, window.solana?.isPhantom && window.solana]
    : [window.solflare?.solana, window.solflare, window.solana?.isSolflare && window.solana];
  return candidates.find(candidate => typeof candidate?.connect === 'function');
}

function standard(name) {
  return wallets.get().find(wallet => wallet.name.toLowerCase() === name.toLowerCase()
    && wallet.chains.includes('solana:mainnet')
    && wallet.features['standard:connect']
    && wallet.features['standard:events']
    && wallet.features['solana:signTransaction']);
}

export async function findWalletProvider(name) {
  if (!supported.has(name)) throw new Error('Unsupported wallet.');
  if (!window.isSecureContext) throw new Error('Wallet connections require HTTPS or localhost.');
  if (name === 'Solflare Web') {
    const { SolflareWalletAdapter } = await import('@solana/wallet-adapter-solflare');
    const adapter = new SolflareWalletAdapter({ network: 'mainnet-beta' });
    adapter.on('error', () => {});
    let address = null;
    adapter.on('connect', key => {
      const next = key.toBase58();
      if (address && address !== next) adapter.emit('accountChanged', key);
      address = next;
    });
    return adapter;
  }
  // Extensions can inject/register shortly after the page first becomes interactive.
  for (let attempt = 0; attempt < 16; attempt++) {
    const provider = injected(name);
    if (provider) return provider;
    const wallet = standard(name);
    if (wallet) {
      const adapter = new StandardWalletAdapter({ wallet });
      adapter.on('error', () => {});
      let address = null;
      adapter.on('connect', key => {
        const next = key.toBase58();
        if (address && address !== next) adapter.emit('accountChanged', key);
        address = next;
      });
      return adapter;
    }
    if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Object.assign(new Error(`${name} is not installed in this browser or is unavailable on this site. Enable its extension and site access, then reload. On mobile, open this HTTPS address inside the wallet app's browser.`), { code: 'WALLET_UNAVAILABLE', wallet: name });
}
