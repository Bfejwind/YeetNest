import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { fromUnits, toUnits, minimumOutput } from "./amounts.js";
import BN from "bn.js";
import { findWalletProvider, requestWalletConnection } from "./wallet-provider.js";
import bs58 from 'bs58';
import { pollTransaction, recordTransaction, readTransactions, TransactionOutcomeError } from './transaction-state.js';
import { validateCurveInstruction } from './transaction-validation.js';
import { withTimeout } from './async-timeout.js';

globalThis.Buffer ||= Buffer;
export const hostedDemo = import.meta.env.MODE === "hosted";
export const SOL = "So11111111111111111111111111111111111111112";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const connection = new Connection(`${location.origin}/api/rpc`, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
});
export let provider = null;
export let publicKey = null;
let session = null;
let connecting = false;
let connectionAttempt = 0;

export async function api(path, options = {}) {
  if (hostedDemo) {
    if (path === "/status") return { network: "demo", jupiter: "offline", uploads: false, uploadProvider: "Not configured", rpc: "offline", hostedDemo: true };
    throw new Error("The online preview supports demo mode only. The mainnet backend is not deployed yet.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
  const response = await fetch(`/api${path}`, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(error => { if (controller.signal.aborted) throw error; return {}; });
  if (response.status === 401) session = null;
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
  } catch(error) {
    if (controller.signal.aborted) throw new Error(path === '/metadata' ? 'Metadata upload timed out. It may have completed on the provider; check Pinata before retrying.' : 'Server request timed out. Check the connection and server logs. For submitted transactions, recheck the signature before retrying.');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function connectWallet(name) {
  if (hostedDemo) throw new Error("Mainnet wallet connections are unavailable in the online demo.");
  if (connecting) throw new Error('A wallet connection request is already in progress. Finish or close it first.');
  connecting = true;
  const attempt = ++connectionAttempt;
  let candidate;
  try {
    candidate = await findWalletProvider(name);
    if (attempt !== connectionAttempt) throw new Error('Wallet connection was cancelled.');
    const result = await requestWalletConnection(candidate, name);
    if (attempt !== connectionAttempt) throw new Error('Wallet connection was cancelled.');
    const key = result?.publicKey || candidate.publicKey;
    if (!key) throw new Error("Wallet did not return a public address.");
    const connectedKey = new PublicKey(key.toString());
    provider = candidate;
    publicKey = connectedKey;
  } catch(error) {
    candidate?.destroy?.();
    throw error;
  } finally { connecting = false; }
  session = null;
  return publicKey.toBase58();
}

export async function disconnectWallet() {
  connectionAttempt++;
  const old = provider;
  provider = null;
  publicKey = null;
  session = null;
  try { await old?.disconnect?.(); }
  finally { old?.destroy?.(); }
}

export async function authenticate() {
  if (!provider || !publicKey)
    throw new Error("Connect your creator wallet first.");
  if (session) return;
  if (!provider.signMessage)
    throw new Error("This wallet does not support creator sign-in.");
  const signer = provider, owner = publicKey.toBase58();
  const challenge = await api("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ wallet: owner }),
  });
  if (provider !== signer || publicKey?.toBase58() !== owner) throw new Error('Wallet changed. Sign in again.');
  const signed = await withTimeout(() => signer.signMessage(
    new TextEncoder().encode(challenge.message),
    "utf8",
  ), 60000, 'Wallet sign-in timed out. Open Phantom/Solflare, unlock it and approve or reject the pending sign-in message, then try again. No launch transaction was submitted.');
  if (provider !== signer || publicKey?.toBase58() !== owner) throw new Error('Wallet changed during sign-in.');
  const signature = Buffer.from(signed.signature || signed).toString("base64");
  const result = await api("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  if (provider !== signer || publicKey?.toBase58() !== owner) throw new Error('Wallet changed during sign-in.');
  session = result.token;
}

export async function balances() {
  if (!publicKey) return { sol: null, tokens: [] };
  const [sol, spl, token2022] = await Promise.all([
    connection.getBalance(publicKey),
    connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }),
    connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    }),
  ]);
  const merged = new Map();
  for (const account of [...spl.value, ...token2022.value]) {
    const { mint, tokenAmount } = account.account.data.parsed.info;
    if (BigInt(tokenAmount.amount) === 0n) continue;
    const prior = merged.get(mint);
    merged.set(mint, {
      mint,
      amount: (
        BigInt(prior?.amount || 0) + BigInt(tokenAmount.amount)
      ).toString(),
      decimals: tokenAmount.decimals,
    });
  }
  return { sol: sol / 1e9, tokens: [...merged.values()] };
}

async function assertMainnet() {
  if (!provider || !publicKey) throw new Error("Connect a live wallet first.");
  if ((await connection.getGenesisHash()) !== MAINNET_GENESIS)
    throw new Error("The configured RPC is not Solana mainnet.");
}

export async function submitAndConfirm(transaction, context = {}) {
  await withTimeout(() => assertMainnet(), 30000, 'Mainnet RPC check timed out before signing. Check the RPC connection; no transaction was submitted by this request.');
  const owner = publicKey.toBase58();
  const signer = provider;
  const original = Buffer.from(transaction.message.serialize());
  const signed = await withTimeout(() => signer.signTransaction(transaction), 60000, 'Wallet transaction signing timed out. No transaction was broadcast by this request. Close the pending wallet prompt and recheck wallet activity before preparing again.');
  if (publicKey?.toBase58() !== owner || provider !== signer) throw new Error('Wallet changed during signing.');
  if (!Buffer.from(signed.message.serialize()).equals(original))
    throw new Error("Wallet changed the transaction message.");
  const signature = bs58.encode(signed.signatures[0]);
  const existing = readTransactions().find(row => row.signature === signature);
  if (existing) throw new TransactionOutcomeError(signature, existing.state, 'This signed transaction was already attempted.');
  recordTransaction({ ...context, signature, wallet: owner, state: 'submitted', network: 'mainnet-beta' });
  try {
    const returned = await withTimeout(() => connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 }), 30000, 'RPC broadcast timed out.');
    if (returned !== signature) throw new Error('RPC returned an unexpected signature.');
  } catch {
    recordTransaction({ signature, state: 'unknown' });
    throw new TransactionOutcomeError(signature, 'unknown', 'Broadcast outcome is unknown.');
  }
  return pollTransaction(connection, signature, { onState: state => recordTransaction({ signature, state }) });
}

export async function recoverTransactions() {
  await assertMainnet();
  const records = readTransactions().filter(row => row.wallet === publicKey.toBase58()).slice(0, 20);
  if (!records.length) return [];
  const { value } = await connection.getSignatureStatuses(records.map(row => row.signature), { searchTransactionHistory: true });
  records.forEach((row, i) => {
    const status = value[i];
    recordTransaction({ signature: row.signature, state: status?.err ? 'failed' : status?.confirmationStatus || (row.state === 'confirmed' || row.state === 'finalized' ? row.state : 'unknown') });
  });
  return readTransactions().filter(row => row.wallet === publicKey.toBase58()).slice(0, 20);
}

export async function prepareSwap(coin, side, amount, slippageBps = 100) {
  await assertMainnet();
  const { value: mint } = await connection.getParsedAccountInfo(new PublicKey(coin.mint));
  if (!mint || !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(mint.owner.toBase58()) || mint.data?.parsed?.type !== 'mint') throw new Error('Token mint could not be verified on-chain.');
  coin = { ...coin, decimals: mint.data.parsed.info.decimals };
  const taker = publicKey.toBase58();
  const inputMint = side === "Buy" ? SOL : coin.mint;
  const outputMint = side === "Buy" ? coin.mint : SOL;
  const units = toUnits(amount, side === "Buy" ? 9 : coin.decimals);
  if (side === 'Buy' && BigInt(units) >= BigInt(await connection.getBalance(publicKey))) throw new Error('Insufficient SOL; leave enough for network fees and rent.');
  if (side === 'Sell') {
    const holdings = await balances();
    if (BigInt(holdings.tokens.find(token => token.mint === coin.mint)?.amount || '0') < BigInt(units)) throw new Error('Insufficient token balance.');
  }
  minimumOutput('1', slippageBps);
  const order = await api(
    `/swap/order?${new URLSearchParams({ inputMint, outputMint, amount: units, taker, slippageBps })}`,
  );
  const tx = VersionedTransaction.deserialize(
    Buffer.from(order.transaction, "base64"),
  );
  const message = Buffer.from(tx.message.serialize());
  const expires = Date.now() + 45000;
  let used = false;
  return {
    output: fromUnits(order.outAmount, side === "Buy" ? coin.decimals : 9),
    minimum: order.otherAmountThreshold ? fromUnits(order.otherAmountThreshold, side === 'Buy' ? coin.decimals : 9) : 'Provider threshold unavailable',
    outputSymbol: side === "Buy" ? coin.ticker : "SOL",
    route: `Jupiter / ${order.router || "aggregator"}`,
    fee: order.feeBps == null ? "Provider quote" : `${order.feeBps / 100}%`,
    slippage:
      order.slippageBps == null
        ? "Jupiter automatic"
        : `${order.slippageBps / 100}%`,
    expires,
    async execute() {
      if (used) throw new Error("This quote has already been submitted.");
      if (!publicKey || publicKey.toBase58() !== taker)
        throw new Error("Wallet changed. Request a new quote.");
      if (Date.now() > expires)
        throw new Error("Quote expired. Request a fresh quote.");
      used = true;
      const signer = provider;
      const signed = await signer.signTransaction(tx);
      if (publicKey?.toBase58() !== taker || provider !== signer) throw new Error('Wallet changed during signing.');
      if (!Buffer.from(signed.message.serialize()).equals(message))
        throw new Error("Wallet changed the transaction message.");
      const signature = bs58.encode(signed.signatures[0]);
      recordTransaction({ signature, wallet: taker, state: 'submitted', network: 'mainnet-beta' });
      let result;
      try {
        result = await api('/swap/execute', { method: 'POST', body: JSON.stringify({ signedTransaction: Buffer.from(signed.serialize()).toString('base64'), requestId: order.requestId }) });
      } catch {
        recordTransaction({ signature, state: 'unknown' });
        throw new TransactionOutcomeError(signature, 'unknown', 'Swap submission outcome is unknown.');
      }
      if (result.status !== "Success")
        {
          recordTransaction({ signature, state: 'unknown' });
          throw new TransactionOutcomeError(signature, 'unknown', `Swap provider did not confirm success: ${result.error || result.code || 'provider rejected transaction'}.`);
        }
      if (!result.signature) throw new Error('Provider did not return a transaction signature.');
      if (result.signature !== signature) throw new TransactionOutcomeError(signature, 'unknown', 'Provider returned an unexpected signature.');
      return pollTransaction(connection, result.signature, { onState: state => recordTransaction({ signature: result.signature, state }) });
    },
  };
}

async function raydium() {
  const sdk = await import("@raydium-io/raydium-sdk-v2");
  const instance = await sdk.Raydium.load({
    owner: publicKey,
    connection,
    cluster: "mainnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
    signAllTransactions: async (txs) => {
      if (provider.signAllTransactions)
        return provider.signAllTransactions(txs);
      const signed = [];
      for (const tx of txs) signed.push(await provider.signTransaction(tx));
      return signed;
    },
  });
  return { sdk, instance };
}

export async function prepareLaunch({ name, ticker, uri, onProgress = () => {} }) {
  onProgress('Checking Solana mainnet...');
  await assertMainnet();
  const owner = publicKey.toBase58();
  onProgress('Loading Raydium launch builder...');
  const { sdk, instance } = await raydium();
  const mint = Keypair.generate();
  const configId = sdk.getPdaLaunchpadConfigId(
    sdk.LAUNCHPAD_PROGRAM,
    new PublicKey(SOL),
    0,
    0,
  ).publicKey;
  onProgress('Loading launch configuration...');
  const account = await connection.getAccountInfo(configId);
  if (!account?.owner.equals(sdk.LAUNCHPAD_PROGRAM))
    throw new Error("Raydium SOL launch configuration is unavailable.");
  const configInfo = sdk.LaunchpadConfig.decode(account.data);
  onProgress('Building launch transactions...');
  const { transactions, extInfo } = await instance.launchpad.createLaunchpad({
    programId: sdk.LAUNCHPAD_PROGRAM,
    mintA: mint.publicKey,
    decimals: 6,
    name,
    symbol: ticker,
    uri,
    migrateType: "cpmm",
    configId,
    configInfo,
    mintBDecimals: 9,
    mintBProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    createOnly: true,
    buyAmount: new BN(0),
    slippage: new BN(100),
    extraSigners: [mint],
    txVersion: sdk.TxVersion.V0,
  });
  for (const tx of transactions) {
    onProgress('Simulating launch transactions...');
    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err)
      throw new Error(
        `Launch simulation failed: ${JSON.stringify(simulation.value.err)}`,
      );
  }
  let used = false;
  const expires = Date.now() + 45000;
  return {
    mint: mint.publicKey.toBase58(),
    poolId: extInfo.address.poolId.toBase58(),
    transactions: transactions.length,
    supply: "1,000,000,000",
    async execute() {
      if (used)
        throw new Error(
          "Launch already submitted. Check your wallet activity before retrying.",
        );
      if (Date.now() > expires)
        throw new Error("Launch preparation expired. Prepare a new launch.");
      if (!publicKey || publicKey.toBase58() !== owner)
        throw new Error("Wallet changed. Prepare the launch again.");
      used = true;
      const signatures = [];
      for (const tx of transactions)
        signatures.push(await submitAndConfirm(tx, { operation: 'launch', mint: mint.publicKey.toBase58(), poolId: extInfo.address.poolId.toBase58() }));
      return signatures;
    },
  };
}

export async function creatorFeeBalance() {
  if (!publicKey) throw new Error("Connect your creator wallet.");
  const sdk = await import("@raydium-io/raydium-sdk-v2");
  const vault = sdk.getPdaCreatorVault(
    sdk.LAUNCHPAD_PROGRAM,
    publicKey,
    new PublicKey(SOL),
  ).publicKey;
  const account = await connection.getAccountInfo(vault);
  if (!account) return { amount: "0", symbol: "WSOL" };
  const result = await connection.getTokenAccountBalance(vault);
  return {
    amount: fromUnits(result.value.amount, result.value.decimals),
    symbol: "WSOL",
  };
}

export async function prepareCreatorClaim() {
  await assertMainnet();
  const owner = publicKey.toBase58();
  const balance = await creatorFeeBalance();
  if (Number(balance.amount) <= 0)
    throw new Error("No SOL-paired creator fees are available to claim.");
  const { sdk, instance } = await raydium();
  const built = await instance.launchpad.claimCreatorFee({
    programId: sdk.LAUNCHPAD_PROGRAM,
    mintB: new PublicKey(SOL),
    txVersion: sdk.TxVersion.V0,
  });
  const simulation = await connection.simulateTransaction(built.transaction);
  if (simulation.value.err)
    throw new Error(
      `Claim simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  const expires = Date.now() + 45000;
  let used = false;
  return {
    ...balance,
    async execute() {
      if (used || Date.now() > expires)
        throw new Error("Claim preparation expired or was already submitted.");
      if (publicKey?.toBase58() !== owner)
        throw new Error("Wallet changed. Prepare the claim again.");
      used = true;
      return submitAndConfirm(built.transaction);
    },
  };
}

export async function walletActivity() {
  if (!publicKey) return [];
  return connection.getSignaturesForAddress(
    publicKey,
    { limit: 20 },
    "confirmed",
  );
}

export async function launchState(coin) {
  const sdk = await import("@raydium-io/raydium-sdk-v2");
  const account = await connection.getAccountInfo(new PublicKey(coin.poolId));
  if (!account?.owner.equals(sdk.LAUNCHPAD_PROGRAM))
    throw new Error("LaunchLab pool could not be loaded.");
  const pool = sdk.LaunchpadPool.decode(account.data);
  const progress = Math.min(
    100,
    (Number(pool.realB.toString()) /
      Number(pool.totalFundRaisingB.toString())) *
      100,
  );
  return {
    pool,
    progress,
    graduated: Number(pool.status) === 2,
    raised: fromUnits(pool.realB.toString(), 9),
    target: fromUnits(pool.totalFundRaisingB.toString(), 9),
  };
}

export async function prepareCurveTrade(coin, side, amount, slippageBps = 100) {
  await assertMainnet();
  const owner = publicKey.toBase58();
  const { sdk, instance } = await raydium();
  const poolInfo = await instance.launchpad.getRpcPoolInfo({
    poolId: new PublicKey(coin.poolId),
  });
  if (Number(poolInfo.status) === 1) throw new Error('Pool is migrating. Trading resumes after graduation completes.');
  if (Number(poolInfo.status) === 2) return prepareSwap(coin, side, amount, slippageBps);
  if (Number(poolInfo.status) !== 0) throw new Error('Unsupported pool status.');
  if (!poolInfo.mintA.equals(new PublicKey(coin.mint)) || !poolInfo.mintB.equals(new PublicKey(SOL))) throw new Error('Pool mints do not match this SOL launch.');
  if (poolInfo.mintDecimalsA !== coin.decimals || poolInfo.mintDecimalsB !== 9) throw new Error('Pool decimals do not match the token.');
  minimumOutput('1', slippageBps);
  const platformAccount = await connection.getAccountInfo(poolInfo.platformId);
  if (!platformAccount?.owner.equals(sdk.LAUNCHPAD_PROGRAM))
    throw new Error("Pool platform configuration could not be loaded.");
  const platformInfo = sdk.PlatformConfig.decode(platformAccount.data);
  const common = {
    programId: sdk.LAUNCHPAD_PROGRAM,
    mintA: new PublicKey(coin.mint),
    mintB: poolInfo.mintB,
    mintAProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    mintBProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    poolInfo,
    configInfo: poolInfo.configInfo,
    platformFeeRate: platformInfo.feeRate,
    slippage: new BN(slippageBps),
    txVersion: sdk.TxVersion.V0,
  };
  const units = new BN(toUnits(amount, side === "Buy" ? 9 : coin.decimals));
  const fees = {
    poolInfo,
    protocolFeeRate: poolInfo.configInfo.tradeFeeRate,
    platformFeeRate: platformInfo.feeRate,
    creatorFeeRate: platformInfo.creatorFeeRate,
    curveType: poolInfo.configInfo.curveType,
    shareFeeRate: new BN(0),
    slot: await connection.getSlot(),
  };
  let output, built, rawOutput, splitFee;
  if (side === "Buy") {
    const preview = sdk.Curve.buyExactIn({ ...fees, amountB: units });
    output = fromUnits(preview.amountA.amount.toString(), coin.decimals);
    rawOutput = preview.amountA.amount.toString();
    splitFee = preview.splitFee;
    built = await instance.launchpad.buyToken({ ...common, buyAmount: units, minMintAAmount: new BN(minimumOutput(rawOutput, slippageBps)) });
  } else {
    const preview = sdk.Curve.sellExactIn({ ...fees, amountA: units });
    output = fromUnits(preview.amountB.toString(), 9);
    rawOutput = preview.amountB.toString();
    splitFee = preview.splitFee;
    built = await instance.launchpad.sellToken({
      ...common,
      sellAmount: units,
      minAmountB: new BN(minimumOutput(rawOutput, slippageBps)),
    });
  }
  const expires = Date.now() + 45000;
  let used = false;
  const tables = await Promise.all(built.transaction.message.addressTableLookups.map(async lookup => {
    const { value } = await connection.getAddressLookupTable(lookup.accountKey);
    if (!value) throw new Error('Transaction lookup table is unavailable.');
    return value;
  }));
  const keys = built.transaction.message.getAccountKeys({ addressLookupTableAccounts: tables });
  validateCurveInstruction(built.transaction, keys, {
    program: sdk.LAUNCHPAD_PROGRAM.toBase58(), owner, side, input: units.toString(), minimum: minimumOutput(rawOutput, slippageBps),
    pool: coin.poolId, mintA: coin.mint, mintB: SOL,
    userA: sdk.getATAAddress(publicKey, new PublicKey(coin.mint), common.mintAProgram).publicKey.toBase58(),
    userB: sdk.getATAAddress(publicKey, new PublicKey(SOL), common.mintBProgram).publicKey.toBase58(),
    vaultA: poolInfo.vaultA.toBase58(), vaultB: poolInfo.vaultB.toBase58(),
    maxSystemLamports: ((side === 'Buy' ? BigInt(units.toString()) : 0n) + BigInt(await connection.getMinimumBalanceForRentExemption(165))).toString(),
  });
  const rent = BigInt(await connection.getMinimumBalanceForRentExemption(165));
  const fee = (await connection.getFeeForMessage(built.transaction.message, 'confirmed')).value;
  if (fee == null) throw new Error('Transaction fee/blockhash is unavailable. Refresh the quote.');
  const requiredSol = (side === 'Buy' ? BigInt(units.toString()) : 0n) + rent * 2n + BigInt(fee);
  if (BigInt(await connection.getBalance(publicKey)) < requiredSol) throw new Error('Insufficient SOL for this trade and the reserved account rent/network fee.');
  if (side === 'Sell' && BigInt((await balances()).tokens.find(token => token.mint === coin.mint)?.amount || '0') < BigInt(units.toString())) throw new Error('Insufficient token balance.');
  const simulation = await connection.simulateTransaction(built.transaction);
  if (simulation.value.err) throw new Error(`Trade simulation failed: ${JSON.stringify(simulation.value.err)}`);
  return {
    output,
    minimum: fromUnits(minimumOutput(rawOutput, slippageBps), side === 'Buy' ? coin.decimals : 9),
    feeDetails: [...Object.entries(splitFee).map(([name, value]) => [name, fromUnits(value.toString(), 9)]), ['Network fee estimate', fromUnits(String(fee), 9)], ['Account rent reserve (may be refunded)', fromUnits((rent * 2n).toString(), 9)]],
    outputSymbol: side === "Buy" ? coin.ticker : "SOL",
    route: "Raydium LaunchLab",
    fee: "On-chain pool rates",
    slippage: `${slippageBps / 100}%`,
    expires,
    async execute() {
      if (used || Date.now() > expires)
        throw new Error("Quote used or expired. Refresh the quote.");
      if (!publicKey || publicKey.toBase58() !== owner)
        throw new Error("Wallet changed. Request a new quote.");
      used = true;
      return submitAndConfirm(built.transaction);
    },
  };
}
