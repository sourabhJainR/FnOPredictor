import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const ttlMs = Math.max(5_000, Number(process.env.CACHE_TTL_MS || 15_000));
const cache = new Map();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public"), { maxAge: "1h" }));

const sources = {
  quote: process.env.BSE_QUOTE_JSON_URL,
  chain: process.env.BSE_OPTION_CHAIN_JSON_URL
};

function configuredUrl(template, params) {
  if (!template) return null;
  const url = new URL(template);
  if (url.protocol !== "https:") throw new Error("Market data endpoints must use HTTPS.");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function fetchJson(kind, params) {
  const template = sources[kind];
  if (!template) return { status: "unconfigured", message: "No permitted JSON feed is configured." };
  const url = configuredUrl(template, params);
  const key = url.toString();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < ttlMs) return { ...cached.value, cacheAgeMs: now - cached.at };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "FnOPredictor/0.1 (personal research tool)" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const data = await response.json();
    const value = { status: "ok", source: url.origin, retrievedAt: new Date().toISOString(), data };
    cache.set(key, { at: now, value });
    return value;
  } catch (error) {
    return { status: "error", message: error.name === "AbortError" ? "Provider timed out." : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/status", (_req, res) => res.json({
  app: "FnOPredictor",
  providers: {
    quote: sources.quote ? "configured" : "not-configured",
    optionChain: sources.chain ? "configured" : "not-configured"
  },
  cacheTtlMs: ttlMs,
  marketHoursTimezone: "Asia/Kolkata"
}));

app.get("/api/market", async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const expiry = String(req.query.expiry || "").trim();
  if (!/^[A-Z0-9._-]{1,30}$/.test(symbol)) return res.status(400).json({ status: "error", message: "Invalid symbol." });
  const [quote, chain] = await Promise.all([
    fetchJson("quote", { symbol }),
    fetchJson("chain", { symbol, expiry })
  ]);
  res.json({ symbol, quote, chain, retrievedAt: new Date().toISOString() });
});

app.get("*", async (_req, res) => {
  try { res.type("html").send(await readFile(path.join(root, "public", "index.html"))); }
  catch { res.status(404).send("Application assets not found."); }
});

app.listen(port, () => console.log(`FnOPredictor listening on :${port}`));
