import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const keys = [
  "SOLANA_RPC_URL",
  "JUPITER_API_KEY",
  "PINATA_JWT",
  "IPFS_GATEWAY",
  "PUBLIC_BASE_URL",
];
export function readSettings(directory) {
  const file = resolve(directory, "provider-settings.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

export function publicHttps(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.includes(".") ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":") ||
    /\.(localhost|local|internal)$/.test(url.hostname) ||
    (url.port && url.port !== "443")
  )
    throw new Error("Use a public HTTPS URL.");
  return url;
}

export function installSetup(app, { config, directory, onSave, upstream, checkStorage }) {
  const token = randomBytes(32).toString("hex");
  const local = (req) => {
    if (config.LOCAL_SETUP_ENABLED === "false") return false;
    const host = req.headers.host?.split(":")[0];
    return (
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      ) && ["localhost", "127.0.0.1"].includes(host)
    );
  };
  app.get("/api/setup", (req, res) => {
    if (!local(req))
      return res
        .status(403)
        .json({ error: "Provider setup is available only from localhost." });
    res.json({
      token,
      configured: Object.fromEntries(
        keys.map((key) => [key, Boolean(config[key])]),
      ),
    });
  });
  app.post("/api/setup", async (req, res, next) => {
    try {
      const supplied = Buffer.from(String(req.headers["x-setup-token"] || ""));
      if (
        !local(req) ||
        supplied.length !== token.length ||
        !timingSafeEqual(supplied, Buffer.from(token))
      )
        return res
          .status(403)
          .json({
            error: "Open provider setup on localhost to save settings.",
          });
      const nextSettings = { ...readSettings(directory) };
      for (const key of keys) {
        const value = req.body[key];
        if (value === undefined || value === "") continue;
        if (
          typeof value !== "string" ||
          value.length > 4096 ||
          /[\r\n\0]/.test(value)
        )
          throw new Error("Invalid provider setting.");
        if (["SOLANA_RPC_URL", "IPFS_GATEWAY", "PUBLIC_BASE_URL"].includes(key))
          publicHttps(value);
        nextSettings[key] =
          key === "PUBLIC_BASE_URL" ? value.replace(/\/$/, "") : value.trim();
      }
      await mkdir(directory, { recursive: true });
      const file = resolve(directory, "provider-settings.json");
      await writeFile(`${file}.tmp`, JSON.stringify(nextSettings, null, 2), {
        mode: 0o600,
      });
      await rename(`${file}.tmp`, file);
      Object.assign(config, nextSettings);
      onSave();
      res.json({ saved: true });
    } catch (error) {
      error.status ||= 400;
      next(error);
    }
  });
  app.get("/api/health", async (req, res) => {
    const checks = await Promise.allSettled([
      upstream(config.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getGenesisHash",
          params: [],
        }),
      }),
      upstream("https://api.jup.ag/tokens/v2/search?query=USDC", {
        headers: config.JUPITER_API_KEY
          ? { "x-api-key": config.JUPITER_API_KEY }
          : {},
      }),
      config.PINATA_JWT
        ? upstream("https://api.pinata.cloud/data/testAuthentication", {
            headers: { Authorization: `Bearer ${config.PINATA_JWT}` },
          })
        : Promise.reject(
            new Error(
              config.PUBLIC_BASE_URL
                ? "Self-hosted uploads configured; public reachability still needs verification."
                : "Configure Pinata or a public upload domain.",
            ),
          ),
      checkStorage(),
    ]);
    const result = checks.map((check, i) => ({
      name: ["Solana RPC", "Jupiter", "Public uploads", "Community storage"][i],
      ok:
        check.status === "fulfilled" &&
        (i !== 0 ||
          check.value.result ===
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"),
      message:
        check.status === "fulfilled"
          ? i === 0 &&
            check.value.result !==
              "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
            ? "RPC is not Solana mainnet."
            : i === 2 ? 'Credentials verified; a real upload still needs testing.' : i === 3 ? 'Community storage responded.' : "Provider responded."
          : i === 2 && !config.PINATA_JWT
            ? check.reason.message
            : "Provider could not be verified. Check your configuration.",
    }));
    res.json({ checks: result });
  });
}
