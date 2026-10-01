import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { fromUnits, toUnits } from "./amounts.js";
import BN from "bn.js";

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

export async function api(path, options = {}) {
  if (hostedDemo) {
    if (path === "/status") return { network: "demo", jupiter: "offline", uploads: false, uploadProvider: "Not configured", rpc: "offline", hostedDemo: true };
    throw new Error("The online preview supports demo mode only. The mainnet backend is not deployed yet.");
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) session = null;
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export async function connectWallet(name) {
  if (hostedDemo) throw new Error("Mainnet wallet connections are unavailable in the online demo.");
  const candidate =
    name === "Phantom"
      ? window.phantom?.solana ||
        (window.solana?.isPhantom ? window.solana : null)
      : window.solflare;
  if (!candidate) throw new Error(`${name} is not installed in this browser.`);
  const result = await candidate.connect();
  const key = result?.publicKey || candidate.publicKey;
  if (!key) throw new Error("Wallet did not return a public address.");
  provider = candidate;
  publicKey = new PublicKey(key.toString());
  session = null;
  return publicKey.toBase58();
}

export async function disconnectWallet() {
  const old = provider;
  provider = null;
  publicKey = null;
  session = null;
  await old?.disconnect();
}

export async function authenticate() {
  if (!provider || !publicKey)
    throw new Error("Connect your creator wallet first.");
  if (session) return;
  if (!provider.signMessage)
    throw new Error("This wallet does not support creator sign-in.");
  const challenge = await api("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ wallet: publicKey.toBase58() }),
  });
  const signed = await provider.signMessage(
    new TextEncoder().encode(challenge.message),
    "utf8",
  );
  const signature = Buffer.from(signed.signature || signed).toString("base64");
  const result = await api("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
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

export async function submitAndConfirm(transaction) {
  const original = Buffer.from(transaction.message.serialize());
  const signed = await provider.signTransaction(transaction);
  if (!Buffer.from(signed.message.serialize()).equals(original))
    throw new Error("Wallet changed the transaction message.");
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  // HTTP polling works with private RPC credentials kept behind our server proxy.
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      const response = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = response.value[0];
      if (status?.err)
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(status.err)}`,
        );
      if (
        status &&
        ["confirmed", "finalized"].includes(status.confirmationStatus)
      )
        return signature;
    } catch (error) {
      if (error.message.startsWith("Transaction ")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Confirmation timed out for ${signature}. Check Solscan before retrying; the transaction may still land.`,
  );
}

export async function prepareSwap(coin, side, amount) {
  await assertMainnet();
  const taker = publicKey.toBase58();
  const inputMint = side === "Buy" ? SOL : coin.mint;
  const outputMint = side === "Buy" ? coin.mint : SOL;
  const units = toUnits(amount, side === "Buy" ? 9 : coin.decimals);
  const order = await api(
    `/swap/order?${new URLSearchParams({ inputMint, outputMint, amount: units, taker })}`,
  );
  const tx = VersionedTransaction.deserialize(
    Buffer.from(order.transaction, "base64"),
  );
  const message = Buffer.from(tx.message.serialize());
  const expires = Date.now() + 45000;
  let used = false;
  return {
    output: fromUnits(order.outAmount, side === "Buy" ? coin.decimals : 9),
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
      const signed = await provider.signTransaction(tx);
      if (!Buffer.from(signed.message.serialize()).equals(message))
        throw new Error("Wallet changed the transaction message.");
      used = true;
      const result = await api("/swap/execute", {
        method: "POST",
        body: JSON.stringify({
          signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
          requestId: order.requestId,
        }),
      });
      if (result.status !== "Success")
        throw new Error(
          `Swap failed${result.signature ? ` (${result.signature})` : ""}: ${result.error || result.code || "provider rejected transaction"}`,
        );
      return result.signature;
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

export async function prepareLaunch({ name, ticker, uri }) {
  await assertMainnet();
  const owner = publicKey.toBase58();
  const { sdk, instance } = await raydium();
  const mint = Keypair.generate();
  const configId = sdk.getPdaLaunchpadConfigId(
    sdk.LAUNCHPAD_PROGRAM,
    new PublicKey(SOL),
    0,
    0,
  ).publicKey;
  const account = await connection.getAccountInfo(configId);
  if (!account)
    throw new Error("Raydium SOL launch configuration is unavailable.");
  const configInfo = sdk.LaunchpadConfig.decode(account.data);
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
        signatures.push(await submitAndConfirm(tx));
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
    graduated: Number(pool.status) !== 0,
    raised: fromUnits(pool.realB.toString(), 9),
    target: fromUnits(pool.totalFundRaisingB.toString(), 9),
  };
}

export async function prepareCurveTrade(coin, side, amount) {
  await assertMainnet();
  const owner = publicKey.toBase58();
  const { sdk, instance } = await raydium();
  const poolInfo = await instance.launchpad.getRpcPoolInfo({
    poolId: new PublicKey(coin.poolId),
  });
  if (Number(poolInfo.status) !== 0) return prepareSwap(coin, side, amount);
  const platformAccount = await connection.getAccountInfo(poolInfo.platformId);
  if (!platformAccount)
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
    slippage: new BN(100),
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
  let output, built;
  if (side === "Buy") {
    const preview = sdk.Curve.buyExactIn({ ...fees, amountB: units });
    output = fromUnits(preview.amountA.amount.toString(), coin.decimals);
    built = await instance.launchpad.buyToken({ ...common, buyAmount: units });
  } else {
    const preview = sdk.Curve.sellExactIn({ ...fees, amountA: units });
    output = fromUnits(preview.amountB.toString(), 9);
    built = await instance.launchpad.sellToken({
      ...common,
      sellAmount: units,
    });
  }
  const expires = Date.now() + 45000;
  let used = false;
  return {
    output,
    outputSymbol: side === "Buy" ? coin.ticker : "SOL",
    route: "Raydium LaunchLab",
    fee: "On-chain pool rates",
    slippage: "1%",
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
