// shared/paprika-identity.js — 第七期批 0（F7-01/F7-02）Paprika 身份复核与启用门禁纯逻辑
// 背景：W5 落库的 38 条映射仅凭「symbol 精确 + 价差」核定，其中 3 条为同 symbol 异资产
// 错配（pump-fun/sky/seeker）。价差永远不能证明身份；本模块把身份判定定版为：
//   symbol 全等（两侧 trim + 大写）
//   且 规范化 name 全等（去通用后缀词 token/network/protocol/...、驼峰拆分）
//   或 命中显式已知别名表 NAME_ALIASES（改名/品牌变体，逐条可审计）。
// 纯函数、无平台 API 依赖：fetcher 运行时、落库复核脚本与测试共用同一口径。

// 通用后缀/修饰词：Paprika 名录常给同一资产加 Token/Network/Protocol 等后缀，
// 或加 Official/The/prev. 等修饰——剥离后比较核心名，不改变资产语义。
const GENERIC_NAME_TOKENS = new Set([
  "token", "network", "protocol", "finance", "dao", "hub", "ecosystem",
  "official", "exchange", "prev", "the", "new",
]);

// 已知别名（规范化后形态 → 规范化后形态）：均为改名/品牌变体，身份经人工核定。
// 新增别名必须逐条给出来源与证据，禁止用模糊包含规则代替。
export const NAME_ALIASES = new Map([
  ["eigencloud", "eigenlayer"], // EigenLayer 改名 EigenCloud，Paprika 仍用旧名
  ["immutable", "immutablex"], // Immutable X
  ["maple", "syrup"], // Maple Finance 的代币名 Syrup（SYRUP）
  ["multiversx", "multiversxelrond"], // MultiversX (Elrond)，原 Elrond 改名
  ["hedera", "hederahashgraph"], // Hedera Hashgraph
  ["prom", "prometeus"], // Prom / Prometeus 同项目
  ["unussedleo", "leo"], // UNUS SED LEO ↔ LEO Token
  ["polexmatic", "polygon"], // POL (ex-MATIC) ↔ Polygon Ecosystem Token
  ["floki", "flokiinu"], // Floki ↔ Floki Inu
]);

export function normalizePaprikaName(name) {
  const spaced = String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // 驼峰拆分（GateToken → Gate Token）
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  let tokens = spaced.split(/\s+/).filter((t) => t && !GENERIC_NAME_TOKENS.has(t));
  let joined = tokens.join("");
  // 拼接形态的通用后缀（UltimaEcosystem → ultimaecosystem → ultima）
  const suffixes = ["ecosystem", "protocol", "network", "finance", "token", "dao", "hub", "new"];
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of suffixes) {
      if (joined.length > s.length && joined.endsWith(s)) {
        joined = joined.slice(0, -s.length);
        changed = true;
      }
    }
  }
  return joined;
}

export function canonicalPaprikaName(name) {
  const n = normalizePaprikaName(name);
  return NAME_ALIASES.get(n) || n;
}

// 身份判定。local: {name?, symbol}；entry: Paprika /v1/coins 条目 {id, name, symbol}。
// name 缺省（fetcher 运行时 COINS 只有 {id, paprikaId}）时退化为「目录 symbol 与
// paprikaId 前缀一致」校验并标注 via="symbol-prefix"——全名身份由落库复核脚本
// （scripts/verify-paprika-identity.mjs，持有本地 name/symbol）强制执行。
export function paprikaIdentityMatch(local, entry) {
  if (!local || !entry || !entry.id) return { ok: false, via: null, reason: "missing_entry" };
  const localSymbol = String(local.symbol || "").trim().toUpperCase();
  const entrySymbol = String(entry.symbol || "").trim().toUpperCase();
  if (!entrySymbol || (localSymbol && entrySymbol !== localSymbol)) {
    return { ok: false, via: null, reason: "symbol_mismatch" };
  }
  if (!localSymbol) {
    // 运行时形态：以 paprikaId 的 symbol 前缀（首个 "-" 之前）与目录 symbol 比对
    const prefix = String(entry.id).split("-")[0].toUpperCase();
    if (prefix !== entrySymbol) return { ok: false, via: null, reason: "symbol_prefix_mismatch" };
    return { ok: true, via: "symbol-prefix", reason: null };
  }
  if (local.name != null && String(local.name) !== "") {
    const a = canonicalPaprikaName(local.name);
    const b = canonicalPaprikaName(entry.name);
    if (!a || a !== b) return { ok: false, via: null, reason: "name_mismatch" };
    return { ok: true, via: NAME_ALIASES.has(normalizePaprikaName(local.name)) || NAME_ALIASES.has(normalizePaprikaName(entry.name)) ? "alias" : "name", reason: null };
  }
  return { ok: true, via: "symbol", reason: null };
}

// 报价有效性（与 fetcher 归一化清洗口径一致）：price 必须是有限正数。
export function paprikaQuoteValid(ticker) {
  const usd = ticker && ticker.quotes && ticker.quotes.USD;
  const p = usd && usd.price;
  return typeof p === "number" && Number.isFinite(p) && p > 0;
}

// 四项计数（分开统计，禁止以非空数冒充有效数）：
//   mapped        paprikaId 为非空字符串的条数
//   identityValid 身份判定通过（见 paprikaIdentityMatch）
//   activeUsable  身份通过且目录条目 is_active=true（yzy 等已下线条目不计）
//   tickerHit     身份通过、活跃，且 tickers 中存在且报价有效
// coins: [{id?, coingeckoId?, name?, symbol?, paprikaId}]
// directory: Paprika /v1/coins 数组；tickers: /v1/tickers 数组。
export function countPaprikaGateStats(coins, directory, tickers) {
  const dirById = new Map();
  if (Array.isArray(directory)) for (const e of directory) if (e && e.id) dirById.set(e.id, e);
  const tickById = new Map();
  if (Array.isArray(tickers)) for (const t of tickers) if (t && t.id) tickById.set(t.id, t);
  const stats = { total: coins.length, mapped: 0, identityValid: 0, activeUsable: 0, tickerHit: 0, failures: [] };
  for (const c of coins) {
    const gid = c && (c.id != null ? c.id : c.coingeckoId);
    const pid = c && typeof c.paprikaId === "string" && c.paprikaId.length > 0 ? c.paprikaId : null;
    if (!pid) continue;
    stats.mapped += 1;
    const entry = dirById.get(pid);
    const m = paprikaIdentityMatch(c, entry);
    if (!m.ok) {
      stats.failures.push({ id: gid, paprikaId: pid, stage: "identity", reason: m.reason });
      continue;
    }
    stats.identityValid += 1;
    if (!entry || entry.is_active !== true) {
      stats.failures.push({ id: gid, paprikaId: pid, stage: "active", reason: "not_active" });
      continue;
    }
    stats.activeUsable += 1;
    const t = tickById.get(pid);
    if (!t || !paprikaQuoteValid(t)) {
      stats.failures.push({ id: gid, paprikaId: pid, stage: "ticker", reason: t ? "quote_invalid" : "ticker_missing" });
      continue;
    }
    stats.tickerHit += 1;
  }
  return stats;
}
