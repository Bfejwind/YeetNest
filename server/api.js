import "dotenv/config";
import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import nacl from "tweetnacl";
import { PublicKey, Connection, VersionedTransaction } from "@solana/web3.js";
import { installSetup, readSettings, publicHttps } from "./setup.js";
import { createCommunityStore } from "./community-store.js";
import { installCommunity } from "./community.js";
import { createAppStore } from './app-store.js';
import { PNG } from 'pngjs';

const address = (value) => {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw Object.assign(new Error("Invalid Solana address."), { status: 400 });
  }
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const text = (value, length) => {
  if (typeof value !== "string" || value.length > length)
    throw fail("Invalid text field.");
  return value.trim();
};
const rpcMethods = new Set([
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  "getLatestBlockhash",
  "getBlockHeight",
  "getEpochInfo",
  "getSlot",
  "getTokenAccountsByOwner",
  "getTokenAccountBalance",
  "getTokenSupply",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "simulateTransaction",
  "sendTransaction",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "getGenesisHash",
]);

export function createApi({
  fetcher = fetch,
  config = process.env,
  storageDir = resolve(process.env.DATA_DIR || "data"),
} = {}) {
  config = config.LOCAL_SETUP_ENABLED === 'false' ? { ...config } : { ...config, ...readSettings(storageDir) };
  const app = express();
  const proxyHops = Number(config.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 2) throw new Error('TRUST_PROXY_HOPS must be 0, 1 or 2.');
  app.set('trust proxy', proxyHops);
  const community = createCommunityStore({ databaseUrl: config.DATABASE_URL, directory: storageDir });
  const persisted = createAppStore({ databaseUrl: config.DATABASE_URL, directory: storageDir });
  app.locals.ready = () => Promise.all([community.ready(), persisted.ready()]);
  app.locals.close = () => Promise.all([community.close(), persisted.close()]);
  const challenges = new Map(),
    sessions = new Map(),
    orders = new Map(),
    limits = new Map();
  const uploadLimits = new Map(),
    marketCache = new Map();
  const images = new Map();
  const imageHosts = new Set([
    "ipfs.io",
    "dweb.link",
    "gateway.pinata.cloud",
    "arweave.net",
    "static.datapi.jup.ag",
    "static.jup.ag",
    "raw.githubusercontent.com",
    "xstocks-metadata.backed.fi",
    "axiomtrading.sfo3.cdn.digitaloceanspaces.com",
    "axiomtrading-v2.axiom-cdn.io",
    "trek-labs.github.io",
    "backpack.exchange",
    "s3-symbol-logo.tradingview.com",
    "cdn.discordapp.com",
    "storage.googleapis.com",
    "cdn.dexscreener.com",
    "cdn.tesseralab.co",
    "cdn.kamino.finance",
    "www.prestocks.com",
    "assets.meteora.ag",
    "thumbnails.padre.gg",
    "ore.supply",
  ]);
  if (config.IPFS_GATEWAY)
    imageHosts.add(new URL(config.IPFS_GATEWAY).hostname);
  let connection = new Connection(
    config.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const route = (handler) => (req, res, next) =>
    Promise.resolve(handler(req, res)).catch(next);
  const records = () => persisted.get('coins');
  const mutate = fn => persisted.mutate('coins', fn);
  const metadataFor = async (wallet, uri) => (await persisted.get('upload-references')).find(([key]) => key === `${wallet}:${uri}`)?.[1];
  async function upstream(url, options = {}) {
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw fail(
        "Provider is unreachable. Check the server connection or try again.",
        502,
      );
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw fail(
        data.errorMessage ||
          data.error?.message ||
          (typeof data.error === "string" ? data.error : "") ||
          `Provider returned HTTP ${response.status}.`,
        response.status === 429 ? 429 : 502,
      );
    return data;
  }
  const jupiter = (path, options = {}) =>
    upstream(`https://api.jup.ag${path}`, {
      ...options,
      headers: {
        ...(config.JUPITER_API_KEY
          ? { "x-api-key": config.JUPITER_API_KEY }
          : {}),
        ...options.headers,
      },
    });
  const auth = (req) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const session = sessions.get(token);
    if (!session || session.expires < Date.now())
      throw fail("Sign in with your creator wallet again.", 401);
    return session.wallet;
  };
  async function pin(bytes, name, type) {
    if (!config.PINATA_JWT) {
      if (!config.PUBLIC_BASE_URL)
        throw fail(
          "Configure Pinata or a public HTTPS upload domain in Integrations.",
          503,
        );
      publicHttps(config.PUBLIC_BASE_URL);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const filename = `${digest}.${type === "image/png" ? "png" : "json"}`;
      await mkdir(resolve(storageDir, "public"), { recursive: true });
      await writeFile(resolve(storageDir, "public", filename), bytes);
      return `${config.PUBLIC_BASE_URL}/uploads/${filename}`;
    }
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    form.append("network", "public");
    const result = await upstream("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.PINATA_JWT}` },
      body: form,
    });
    if (!/^[a-zA-Z0-9]+$/.test(result.data?.cid || ""))
      throw fail("Upload provider returned an invalid CID.", 502);
    return `${config.IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/"}${result.data.cid}`;
  }
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host)
      return res
        .status(403)
        .json({ error: "Cross-origin API requests are not allowed." });
    const now = Date.now();
    for (const map of [challenges, sessions, orders, uploadLimits])
      for (const [key, value] of map) if (value.expires < now) map.delete(key);
    for (const [key, value] of limits)
      if (value.reset < now) limits.delete(key);
    if (limits.size > 10000)
      return res
        .status(503)
        .json({ error: "Server is busy. Try again shortly." });
    const key = req.ip;
    const rate = limits.get(key) || { count: 0, reset: now + 60000 };
    limits.set(key, rate);
    if (++rate.count > 180)
      return res
        .status(429)
        .json({ error: "Too many requests. Try again in one minute." });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", express.json({ limit: "4mb" }));
  installCommunity(app, { store: community, auth, address, text, route, fail });
  app.get('/api/watchlist', route(async (req, res) => res.json(await persisted.get(`watchlist:${auth(req)}`))));
  app.put('/api/watchlist', route(async (req, res) => {
    const wallet = auth(req);
    if (!Array.isArray(req.body.mints) || req.body.mints.length > 200) throw fail('Watchlist must contain at most 200 mints.');
    const mints = [...new Set(req.body.mints.map(address))];
    await persisted.mutate(`watchlist:${wallet}`, values => { values.splice(0, values.length, ...mints); });
    res.json(mints);
  }));
  app.use(
    "/uploads",
    express.static(resolve(storageDir, "public"), {
      dotfiles: "deny",
      immutable: true,
      maxAge: "1y",
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );
  installSetup(app, {
    config,
    directory: storageDir,
    upstream,
    checkStorage: () => app.locals.ready(),
    onSave: () => {
      connection = new Connection(
        config.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
        "confirmed",
      );
      if (config.IPFS_GATEWAY)
        imageHosts.add(new URL(config.IPFS_GATEWAY).hostname);
    },
  });
  app.get("/api/status", (req, res) =>
    res.json({
      network: "mainnet-beta",
      jupiter: config.JUPITER_API_KEY ? "configured" : "keyless",
      uploads: Boolean(config.PINATA_JWT || config.PUBLIC_BASE_URL),
      uploadProvider: config.PINATA_JWT
        ? "Pinata"
        : config.PUBLIC_BASE_URL
          ? "Self-hosted"
          : "Not configured",
      rpc: config.SOLANA_RPC_URL ? "configured" : "public",
      marketData: ["DexScreener", "GeckoTerminal"],
      communityStorage: community.kind,
      catalogueStorage: persisted.kind,
      community: true,
      moderationService: false,
    }),
  );
  app.post(
    "/api/rpc",
    route(async (req, res) => {
      const { method, params } = req.body;
      if (!rpcMethods.has(method) || !Array.isArray(params))
        throw fail("Unsupported RPC request.");
      const result = await upstream(
        config.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: req.body.id || 1,
            method,
            params,
          }),
        },
      );
      res.json(result);
    }),
  );
  app.get(
    "/api/tokens",
    route(async (req, res) => {
      const query = String(req.query.query || "").slice(0, 100);
      res.json(
        await jupiter(
          query
            ? `/tokens/v2/search?query=${encodeURIComponent(query)}`
            : "/tokens/v2/toptraded/24h",
        ),
      );
    }),
  );
  app.get(
    "/api/coins",
    route(async (req, res) => res.json(await records())),
  );
  app.get(
    "/api/artwork",
    route(async (req, res) => {
      const url = new URL(String(req.query.uri));
      if (config.PUBLIC_BASE_URL && url.href.startsWith(`${config.PUBLIC_BASE_URL}/uploads/`)) {
        const filename = url.href.slice(`${config.PUBLIC_BASE_URL}/uploads/`.length);
        if (!/^[a-f0-9]{64}\.png$/.test(filename)) throw fail("Invalid artwork reference.");
        const file = resolve(storageDir, "public", filename);
        if (!existsSync(file)) throw fail("Artwork not found.", 404);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.type("image/png").send(readFileSync(file));
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !imageHosts.has(url.hostname)
      )
        throw fail("Artwork host is not supported.", 400);
      let image = images.get(url.href);
      if (!image || image.expires < Date.now()) {
        let response;
        try {
          response = await fetcher(url.href, {
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
        } catch {
          throw fail("Artwork provider is unavailable.", 502);
        }
        const type = response.headers.get("content-type")?.split(";")[0];
        if (
          !response.ok ||
          ![
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/svg+xml",
          ].includes(type)
        )
          throw fail("Artwork provider did not return an image.", 502);
        const reader = response.body.getReader(),
          chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw fail("Artwork exceeds 2 MB.", 413);
          }
          chunks.push(Buffer.from(value));
        }
        image = {
          type,
          bytes: Buffer.concat(chunks),
          expires: Date.now() + 1800000,
        };
        if (images.size >= 32) images.delete(images.keys().next().value);
        images.set(url.href, image);
      }
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.type(image.type).send(image.bytes);
    }),
  );
  app.post(
    "/api/auth/challenge",
    route(async (req, res) => {
      const wallet = address(req.body.wallet);
      const nonce = randomBytes(24).toString("hex");
      const domain = text(req.headers.host || '', 255);
      const message = `YeetNest creator sign-in\nDomain: ${domain}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(Date.now() + 300000).toISOString()}\nThis is a sign-in message, not a transaction.`;
      challenges.set(nonce, { wallet, message, domain, expires: Date.now() + 300000 });
      res.json({ nonce, message });
    }),
  );
  app.post(
    "/api/auth/verify",
    route(async (req, res) => {
      const challenge = challenges.get(req.body.nonce);
      challenges.delete(req.body.nonce);
      if (!challenge || challenge.expires < Date.now() || challenge.domain !== req.headers.host)
        throw fail("Sign-in challenge expired.", 401);
      const signature = Buffer.from(String(req.body.signature), "base64");
      if (
        signature.length !== 64 ||
        !nacl.sign.detached.verify(
          Buffer.from(challenge.message),
          signature,
          new PublicKey(challenge.wallet).toBytes(),
        )
      )
        throw fail("Invalid wallet signature.", 401);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, {
        wallet: challenge.wallet,
        expires: Date.now() + 3600000,
      });
      res.json({ token });
    }),
  );
  app.post(
    "/api/metadata",
    route(async (req, res) => {
      const wallet = auth(req);
      const rate = uploadLimits.get(wallet);
      if (rate && rate.expires > Date.now() && rate.count >= 8)
        throw fail("Upload limit reached. Try again in an hour.", 429);
      uploadLimits.set(
        wallet,
        rate && rate.expires > Date.now()
          ? { ...rate, count: rate.count + 1 }
          : { count: 1, expires: Date.now() + 3600000 },
      );
      const name = text(req.body.name, 32),
        symbol = text(req.body.ticker, 10),
        description = text(req.body.description || "", 500);
      if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol))
        throw fail("Name and ticker are required.");
      const imageData = String(req.body.image || "");
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imageData))
        throw fail("Upload a PNG image.");
      let bytes = Buffer.from(imageData.split(",")[1], "base64");
      if (
        bytes.length > 2 * 1024 * 1024 ||
        bytes.length < 24 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.subarray(12, 16).toString() !== 'IHDR' ||
        bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 ||
        bytes.readUInt32BE(16) > 512 ||
        bytes.readUInt32BE(20) > 512
      )
        throw fail("Image must be a valid PNG under 2 MB and 512 pixels.");
      try { bytes = PNG.sync.write(PNG.sync.read(bytes, { checkCRC: true })); }
      catch { throw fail('Image could not be decoded as a valid PNG.'); }
      const socials = {};
      for (const key of ["website", "twitter", "telegram"])
        if (req.body[key]) {
          const url = publicHttps(text(req.body[key], 200));
          if (
            key === "twitter" &&
            !["x.com", "twitter.com"].includes(url.hostname)
          )
            throw fail("Use an x.com or twitter.com profile.");
          if (key === "telegram" && url.hostname !== "t.me")
            throw fail("Use a t.me Telegram link.");
          socials[key] = url.href;
        }
      const image = await pin(bytes, `${symbol}.png`, "image/png");
      const uri = await pin(
        Buffer.from(
          JSON.stringify({
            name,
            symbol,
            description,
            image,
            ...socials,
            properties: {
              creators: [{ address: wallet, share: 100 }],
              files: [{ uri: image, type: "image/png" }],
            },
          }),
        ),
        `${symbol}.json`,
        "application/json",
      );
      const reference = {
        uri,
        wallet,
        name,
        ticker: symbol,
        description,
        image,
        socials,
        expires: Date.now() + 31536000000,
      };
      await persisted.mutate('upload-references', entries => {
        const key = `${wallet}:${uri}`;
        const prior = entries.findIndex(([id]) => id === key);
        if (prior >= 0) entries[prior] = [key, reference];
        else entries.push([key, reference]);
      });
      res.json({ uri, image });
    }),
  );
  app.post(
    "/api/coins",
    route(async (req, res) => {
      const creator = auth(req),
        mint = address(req.body.mint),
        poolId = address(req.body.poolId);
      const metadata = await metadataFor(creator, req.body.uri);
      if (!metadata || metadata.wallet !== creator)
        throw fail("Upload metadata with this creator wallet first.");
      // Trust chain ownership, rather than a client-supplied creator field.
      const { LaunchpadPool, LAUNCHPAD_PROGRAM, getPdaLaunchpadPoolId } =
        await import("@raydium-io/raydium-sdk-v2");
      const account = await connection.getAccountInfo(new PublicKey(poolId));
      if (!account?.owner.equals(LAUNCHPAD_PROGRAM))
        throw fail("Raydium pool is not confirmed yet. Retry registration.");
      const pool = LaunchpadPool.decode(account.data);
      const expected = getPdaLaunchpadPoolId(
        LAUNCHPAD_PROGRAM,
        new PublicKey(mint),
        pool.mintB,
      ).publicKey;
      if (
        !expected.equals(new PublicKey(poolId)) ||
        !pool.creator.equals(new PublicKey(creator)) ||
        !pool.mintA.equals(new PublicKey(mint))
      )
        throw fail("This wallet does not own the launch.", 403);
      const coin = {
        id: mint,
        mint,
        poolId,
        creator,
        name: metadata.name,
        ticker: metadata.ticker,
        description: metadata.description,
        image: metadata.image,
        socials: metadata.socials,
        uri: req.body.uri,
        pair: "SOL",
        created: Date.now(),
        source: "Raydium LaunchLab",
        decimals: 6,
      };
      await mutate((coins) => {
        if (!coins.some((c) => c.mint === mint)) coins.unshift(coin);
      });
      res.json(coin);
    }),
  );
  app.patch(
    "/api/coins/:mint/image",
    route(async (req, res) => {
      const creator = auth(req),
        mint = address(req.params.mint),
        metadata = await metadataFor(creator, req.body.uri);
      if (!metadata || metadata.wallet !== creator)
        throw fail("Upload the new artwork with your creator wallet first.");
      const result = await mutate((coins) => {
        const coin = coins.find((c) => c.mint === mint);
        if (!coin || coin.creator !== creator)
          throw fail("Only the launch creator can change this image.", 403);
        coin.image = metadata.image;
        return coin;
      });
      res.json(result);
    }),
  );
  app.get(
    "/api/market/:mint",
    route(async (req, res) => {
      const mint = address(req.params.mint);
      const cached = marketCache.get(mint);
      if (cached && cached.expires > Date.now()) return res.json(cached.data);
      const pairs = await upstream(
        `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
      );
      if (!Array.isArray(pairs))
        throw fail("Market provider returned an invalid response.", 502);
      const pair = pairs
        .filter((p) => p.baseToken?.address === mint && p.chainId === "solana")
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (!pair)
        return res.json({
          pair: null,
          candles: [],
          chartError: "This token has no indexed trading pool yet.",
        });
      const poolAddress = address(pair.pairAddress);
      let candles = [],
        chartError = "";
      try {
        const response = await upstream(
          `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=72&currency=usd&token=base`,
          { headers: { Accept: "application/json;version=20230302" } },
        );
        candles = response.data?.attributes?.ohlcv_list || [];
        if (!Array.isArray(candles)) candles = [];
        if (!candles.length)
          chartError = "Price history has not been indexed for this pool yet.";
      } catch {
        chartError =
          "Historical candles are unavailable from GeckoTerminal right now.";
      }
      const data = {
        pair,
        candles,
        chartError,
        updatedAt: Date.now(),
        sources: ["DexScreener", "GeckoTerminal"],
      };
      if (marketCache.size >= 100)
        marketCache.delete(marketCache.keys().next().value);
      marketCache.set(mint, { data, expires: Date.now() + 60000 });
      res.json(data);
    }),
  );
  app.get('/api/holders/:mint', route(async (req, res) => {
    const mint = new PublicKey(address(req.params.mint));
    const [largest, supply] = await Promise.all([connection.getTokenLargestAccounts(mint), connection.getTokenSupply(mint)]);
    res.json({ accounts: largest.value.map(value => ({ address: value.address.toBase58(), amount: value.amount, decimals: value.decimals })), supply: supply.value.amount, slot: largest.context.slot, updatedAt: Date.now(), scope: 'largest-token-accounts-not-unique-holders' });
  }));
  app.get('/api/trades/:mint', route(async (req, res) => {
    const mint = address(req.params.mint);
    const pairs = await upstream(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    const pair = Array.isArray(pairs) ? pairs.filter(p => p.chainId === 'solana' && p.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] : null;
    if (!pair) return res.json({ trades: [], unavailable: 'No indexed pool.', updatedAt: Date.now() });
    const data = await upstream(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${address(pair.pairAddress)}/trades`, { headers: { Accept: 'application/json;version=20230302' } });
    res.json({ trades: (data.data || []).slice(0, 20).map(row => row.attributes), source: 'GeckoTerminal', updatedAt: Date.now() });
  }));
  let indexed = { coins: [], expires: 0 };
  app.get(
    "/api/launches",
    route(async (req, res) => {
      const coins = await records();
      if (!coins.length) return res.json([]);
      const offset = Number(req.query.offset || 0), limit = Number(req.query.limit || 100);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Invalid discovery page.');
      const key = `${offset}:${limit}:${coins.length}`;
      if (indexed.expires > Date.now() && indexed.key === key)
        return res.json(indexed.coins);
      const selected = coins.slice(offset, offset + limit);
      const sdk = await import("@raydium-io/raydium-sdk-v2");
      const accounts = await connection.getMultipleAccountsInfo(
        selected.map((c) => new PublicKey(c.poolId)),
      );
      const updated = selected.map((coin, i) => {
        if (!accounts[i]?.owner.equals(sdk.LAUNCHPAD_PROGRAM)) return coin;
        const pool = sdk.LaunchpadPool.decode(accounts[i].data);
        const target = Number(pool.totalFundRaisingB.toString());
        return {
          ...coin,
          progress:
            target > 0
              ? Math.min(100, (Number(pool.realB.toString()) / target) * 100)
              : 0,
          launchStatus:
            ["Trading", "Migrating", "Graduated"][pool.status] || "Unknown",
          raised: pool.realB.toString(),
          target: pool.totalFundRaisingB.toString(),
          updatedAt: Date.now(),
        };
      });
      indexed = { key, coins: updated, expires: Date.now() + 30000 };
      res.json(updated);
    }),
  );
  app.get(
    "/api/swap/order",
    route(async (req, res) => {
      const inputMint = address(req.query.inputMint),
        outputMint = address(req.query.outputMint),
        taker = address(req.query.taker);
      const amount = String(req.query.amount);
      const slippageBps = Number(req.query.slippageBps || 100);
      if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw fail('Slippage must be between 0.01% and 5%.');
      if (
        !/^\d{1,20}$/.test(amount) ||
        BigInt(amount) <= 0n ||
        BigInt(amount) > 18446744073709551615n ||
        inputMint === outputMint
      )
        throw fail("Invalid swap amount or pair.");
      const order = await jupiter(
        `/swap/v2/order?${new URLSearchParams({ inputMint, outputMint, amount, taker, slippageBps })}`,
      );
      if (!order.transaction || !order.requestId)
        throw fail(
          order.errorMessage ||
            "No executable route is available for this pair.",
          422,
        );
      const tx = VersionedTransaction.deserialize(
        Buffer.from(order.transaction, "base64"),
      );
      if (
        !tx.message.staticAccountKeys
          .slice(0, tx.message.header.numRequiredSignatures)
          .some((key) => key.toBase58() === taker)
      )
        throw fail(
          "Quote transaction does not require your wallet signature.",
          502,
        );
      orders.set(order.requestId, {
        message: Buffer.from(tx.message.serialize()).toString("base64"),
        wallet: taker,
        expires: Date.now() + 60000,
      });
      res.json(order);
    }),
  );
  app.post(
    "/api/swap/execute",
    route(async (req, res) => {
      const order = orders.get(req.body.requestId);
      if (!order || order.expires < Date.now())
        throw fail("Quote expired. Request a new quote.", 410);
      const tx = VersionedTransaction.deserialize(
        Buffer.from(String(req.body.signedTransaction), "base64"),
      );
      const message = tx.message.serialize();
      const index = tx.message.staticAccountKeys.findIndex(
        (key) => key.toBase58() === order.wallet,
      );
      if (
        Buffer.from(message).toString("base64") !== order.message ||
        index < 0 ||
        index >= tx.signatures.length ||
        !nacl.sign.detached.verify(
          message,
          tx.signatures[index],
          new PublicKey(order.wallet).toBytes(),
        )
      )
        throw fail(
          "Signed transaction does not match the reviewed quote.",
          403,
        );
      orders.delete(req.body.requestId);
      res.json(
        await jupiter("/swap/v2/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: req.body.requestId,
            signedTransaction: req.body.signedTransaction,
          }),
        }),
      );
    }),
  );
  app.use("/api", (error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.status || 500)
      .json({
        error: error.status
          ? error.message
          : "Request failed. Check the provider configuration and try again.",
      });
  });
  return app;
}
