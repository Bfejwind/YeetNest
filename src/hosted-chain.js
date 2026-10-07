export const hostedDemo = true;
export const SOL = 'So11111111111111111111111111111111111111112';
export const publicKey = null;
export const provider = null;

export async function api(path) {
  if (path === '/status') return {
    network: 'demo', jupiter: 'offline', uploads: false,
    uploadProvider: 'Not configured', rpc: 'offline', hostedDemo: true,
  };
  throw new Error('The online preview supports demo mode only. The mainnet backend is not deployed yet.');
}

async function unavailable() {
  throw new Error('Mainnet transactions are unavailable in the online demo.');
}
export const connectWallet = unavailable;
export const authenticate = unavailable;
export const balances = unavailable;
export const prepareLaunch = unavailable;
export const prepareCurveTrade = unavailable;
export const prepareSwap = unavailable;
export const creatorFeeBalance = unavailable;
export const prepareCreatorClaim = unavailable;
export const walletActivity = unavailable;
export const recoverTransactions = unavailable;
export async function disconnectWallet() {}
