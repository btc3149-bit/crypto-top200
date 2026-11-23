// shared/paprika-identity.js — 第七期批 0（F7-01/F7-02）Paprika 身份复核与启用门禁纯逻辑
// 背景：W5 落库的 38 条映射仅凭「symbol 精确 + 价差」核定，其中 3 条为同 symbol 异资产
// 错配（pump-fun/sky/seeker）。价差永远不能证明身份；本模块把身份判定定版为：
//   symbol 全等（两侧 trim + 大写）
//   且 规范化 name 全等（去通用后缀词 token/network/protocol/...、驼峰拆分）
//   或 命中显式已知别名表 NAME_ALIASES（改名/品牌变体，逐条可审计）。
// 纯函数、无平台 API 依赖：fetcher 运行时、落库复核脚本与测试共用同一口径。
//
// 第八期批 0 修订（F8-01/F8-02/F8-16/F8-18/F8-21）：
// - F8-01：运行时身份不再自洽比对。身份登记册（workers/fetcher/src/paprika-registry.js，
//   由 scripts/verify-paprika-identity.mjs --write-registry 经全名复核生成并入仓）经
//   opts.registry 传入 countPaprikaGateStats：运行时以登记册中经复核的 CG 侧
//   name/symbol 与实时目录条目做全名判定；paprikaId 不在登记册或 cgId 不符即拦下。
//   登记册与币表的一致性由 tests/paprika-gate.test.mjs 强制校验（部署门禁跑全量测试）。
// - F8-02：tickerHit 增设市值交叉合理性校验——Paprika ticker 市值与 CG 快照市值
//   之比低于 PAPRIKA_MCAP_RATIO_MIN 即判 plausibility 失败（同资产 -token 次级条目
//   价格对、市值差约两个数量级，靠此拦下）；例外须登记 PAPRIKA_PLAUSIBILITY_EXCEPTIONS。
// - F8-16：mapped 计数一律经 shared/board-schema.js 的 isValidPaprikaId，禁止 truthy 计数。
// - F8-18：同一 paprikaId 被多个本地币引用时只计一次，重复项记 duplicate 失败。
// - F8-21：启用门禁阈值与四计数定义收敛到本模块（PAPRIKA_GATE_RATIO /
//   paprikaGateThreshold / evaluatePaprikaGate），fetcher preflight、source-state
//   与各核验脚本同源引用，禁止另立口径。
import { COVERAGE_RATIO, isValidPaprikaId } from "./board-schema.js";

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
// F8-01 起 fetcher 运行时不再直接以空 local 调用本函数：countPaprikaGateStats 经
// 身份登记册把经全名复核的 CG 侧 name/symbol 作为 local 传入（见文件头）。
// local 无 symbol 的旧退化形态（目录 symbol 与 paprikaId 前缀比对，via="symbol-prefix"）
// 仅保留给无登记册的离线兼容调用，运行时门禁不得走此路。
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

// ===== F8-21 启用门禁单一事实源 =====
// 阈值 = 发布覆盖门禁 COVERAGE_RATIO（0.94，200 币即 188），四项计数任一低于
// paprikaGateThreshold(total) 即不放行。fetcher preflight（经 source-state 转出）、
// verify-paprika-identity / verify-paprika-coverage 两脚本均引用此处，禁止另立口径。
export const PAPRIKA_GATE_RATIO = COVERAGE_RATIO;
export function paprikaGateThreshold(total) {
  return Math.ceil(PAPRIKA_GATE_RATIO * (typeof total === "number" && total > 0 ? total : 0));
}
export function evaluatePaprikaGate(stats, total) {
  const n = typeof total === "number" ? total : stats && stats.total;
  const threshold = paprikaGateThreshold(n || 0);
  const counts = {
    mapped: (stats && stats.mapped) || 0,
    identityValid: (stats && stats.identityValid) || 0,
    activeUsable: (stats && stats.activeUsable) || 0,
    tickerHit: (stats && stats.tickerHit) || 0,
  };
  const failures = Object.entries(counts)
    .filter(([, v]) => v < threshold)
    .map(([k, v]) => `${k} ${v}/${n} < ${threshold} required (94% publish gate, F7-02/F8-21)`);
  return { ok: failures.length === 0, threshold, total: n, counts, failures };
}

// ===== F8-02 市值交叉合理性校验 =====
// Paprika ticker 市值 / CG 快照市值 的下限。同资产次级条目（atom-cosmos-token 等）
// 价格与主条目几乎相同、市值仅约 0.4%–0.8%（2026-11-23 实测），主条目约 63%–77%；
// 阈值 5% 两侧均留一个数量级以上余量。参考市值来自登记册 cgSnapshotMcapUsd
// （生成时取自 data/coins.json 的 snapshotMcapUsd）或 coin 自带 snapshotMcapUsd。
export const PAPRIKA_MCAP_RATIO_MIN = 0.05;
// 合理性例外登记（逐条审计，禁止静默放行）：Paprika 侧数据质量问题、无更优条目可选时
// 登记于此，命中例外者在 stats.plausibilityExceptions 中留痕、仍计 tickerHit。
export const PAPRIKA_PLAUSIBILITY_EXCEPTIONS = new Map([
  [
    "htx-htx",
    {
      cgId: "htx-dao",
      reason: "Paprika 侧唯一活跃条目，市值仅为 CG 的约 0.1%，属 Paprika 数据质量问题、非映射错误，无更优条目可选（F8-02 报告证据）",
      evidence: "2026-11-23 实测：Paprika htx-htx ticker 市值 $1,382,000 approx、rank 1273、is_active=true；CG 快照市值 $1,370,000,000；比值约 0.001",
    },
  ],
]);

function registryToMap(registry) {
  if (!registry) return null;
  if (registry instanceof Map) return registry;
  const m = new Map();
  for (const e of registry) if (e && e.paprikaId) m.set(e.paprikaId, e);
  return m;
}

// 四项计数（分开统计，禁止以非空数冒充有效数）：
//   mapped        paprikaId 合法（isValidPaprikaId，F8-16）且去重后（F8-18）的条数
//   identityValid 身份判定通过：传入 opts.registry 时以登记册复核身份为准（F8-01）；
//                 未传登记册时用 coin 自带 name/symbol 全名判定（离线复核口径）
//   activeUsable  身份通过且目录条目 is_active=true（yzy 等已下线条目不计）
//   tickerHit     身份通过、活跃、tickers 中存在且报价有效，且市值交叉合理性
//                 通过或命中已登记例外（F8-02）
// coins: [{id?, coingeckoId?, name?, symbol?, paprikaId, snapshotMcapUsd?}]
// directory: Paprika /v1/coins 数组；tickers: /v1/tickers 数组。
// opts.registry: 登记册（数组或 Map，paprikaId → {cgId, cgName, cgSymbol, cgSnapshotMcapUsd}）。
export function countPaprikaGateStats(coins, directory, tickers, opts = {}) {
  const dirById = new Map();
  if (Array.isArray(directory)) for (const e of directory) if (e && e.id) dirById.set(e.id, e);
  const tickById = new Map();
  if (Array.isArray(tickers)) for (const t of tickers) if (t && t.id) tickById.set(t.id, t);
  const reg = registryToMap(opts && opts.registry);
  const stats = {
    total: coins.length,
    mapped: 0,
    identityValid: 0,
    activeUsable: 0,
    tickerHit: 0,
    failures: [],
    plausibilityExceptions: [],
  };
  const seenPaprikaIds = new Set();
  for (const c of coins) {
    const gid = c && (c.id != null ? c.id : c.coingeckoId);
    const rawPid = c ? c.paprikaId : null;
    if (rawPid == null || rawPid === "") continue; // 未映射：合法状态，不计 mapped
    if (typeof rawPid !== "string" || !isValidPaprikaId(rawPid)) {
      stats.failures.push({ id: gid, paprikaId: rawPid, stage: "mapped", reason: "paprika_id_malformed" });
      continue;
    }
    const pid = rawPid;
    if (seenPaprikaIds.has(pid)) {
      // F8-18：同一 paprikaId 被多个本地币引用只计一次，重复项不进任何计数。
      stats.failures.push({ id: gid, paprikaId: pid, stage: "duplicate", reason: "duplicate_paprika_id" });
      continue;
    }
    seenPaprikaIds.add(pid);
    stats.mapped += 1;
    const entry = dirById.get(pid);
    let regEntry = null;
    if (reg) {
      regEntry = reg.get(pid) || null;
      if (!regEntry) {
        stats.failures.push({ id: gid, paprikaId: pid, stage: "identity", reason: "registry_missing" });
        continue;
      }
      if (regEntry.cgId !== gid) {
        stats.failures.push({ id: gid, paprikaId: pid, stage: "identity", reason: "registry_cg_mismatch" });
        continue;
      }
    }
    // 身份判定本地侧：coin 自带 name/symbol 时用 coin（离线全名口径）；运行时 coin
    // 只有 {id, paprikaId} 时用登记册中经全名复核的 CG 侧 name/symbol（F8-01）。
    const local =
      c && (c.symbol || c.name)
        ? c
        : regEntry
          ? { name: regEntry.cgName, symbol: regEntry.cgSymbol }
          : c;
    const m = paprikaIdentityMatch(local, entry);
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
    // F8-02 市值交叉合理性：ticker 市值与 CG 参考市值量级须相符（价格对不证明市值对）。
    const refMcap = regEntry && regEntry.cgSnapshotMcapUsd != null ? regEntry.cgSnapshotMcapUsd : c.snapshotMcapUsd;
    const papMcap = t.quotes && t.quotes.USD ? t.quotes.USD.market_cap : null;
    if (typeof refMcap === "number" && refMcap > 0 && typeof papMcap === "number" && Number.isFinite(papMcap) && papMcap > 0) {
      const ratio = papMcap / refMcap;
      if (ratio < PAPRIKA_MCAP_RATIO_MIN) {
        const ex = PAPRIKA_PLAUSIBILITY_EXCEPTIONS.get(pid);
        if (ex && ex.cgId === gid) {
          stats.plausibilityExceptions.push({ id: gid, paprikaId: pid, ratio });
        } else {
          stats.failures.push({ id: gid, paprikaId: pid, stage: "plausibility", reason: "mcap_ratio_too_low", ratio });
          continue;
        }
      }
    }
    stats.tickerHit += 1;
  }
  return stats;
}

// ===== F8-01 身份登记册生成与一致性校验（纯函数，脚本与测试共用） =====
// 由本地币表（带 name/symbol/snapshotMcapUsd）与 Paprika 目录做全名身份复核，
// 通过者生成登记条目；不通过者进 failures、不入册（运行时据此拦下）。
export function buildPaprikaRegistry(coins, directory) {
  const dirById = new Map();
  if (Array.isArray(directory)) for (const e of directory) if (e && e.id) dirById.set(e.id, e);
  const entries = [];
  const failures = [];
  for (const c of coins || []) {
    const gid = c && (c.id != null ? c.id : c.coingeckoId);
    const pid = c && typeof c.paprikaId === "string" && isValidPaprikaId(c.paprikaId) ? c.paprikaId : null;
    if (!pid) continue;
    const entry = dirById.get(pid);
    const m = paprikaIdentityMatch({ name: c.name, symbol: c.symbol }, entry);
    if (!m.ok) {
      failures.push({ id: gid, paprikaId: pid, stage: "identity", reason: m.reason });
      continue;
    }
    entries.push({
      cgId: gid,
      paprikaId: pid,
      cgName: c.name != null ? c.name : null,
      cgSymbol: c.symbol != null ? c.symbol : null,
      paprikaName: entry && entry.name != null ? entry.name : null,
      paprikaSymbol: entry && entry.symbol != null ? entry.symbol : null,
      cgSnapshotMcapUsd: c.snapshotMcapUsd != null ? c.snapshotMcapUsd : null,
      paprikaRank: entry && entry.rank != null ? entry.rank : null,
    });
  }
  return { entries, failures };
}

// 登记册新鲜度/一致性：本地币表（coins-list / coins.json 解码形）与登记册逐条比对
// CG 侧字段（cgId/paprikaId/cgName/cgSymbol/cgSnapshotMcapUsd）。任一不一致返回
// 描述列表（空数组 = 一致）。目录侧字段（paprikaName 等）随目录漂移，由运行时
// 身份判定对实时目录校验，不在此比对。
export function diffPaprikaRegistry(coins, registryEntries) {
  const regByCgId = new Map();
  for (const e of registryEntries || []) if (e && e.cgId) regByCgId.set(e.cgId, e);
  const problems = [];
  const seenCg = new Set();
  for (const c of coins || []) {
    const gid = c && (c.id != null ? c.id : c.coingeckoId);
    const pid = c && typeof c.paprikaId === "string" && c.paprikaId !== "" ? c.paprikaId : null;
    if (!pid) continue;
    seenCg.add(gid);
    const e = regByCgId.get(gid);
    if (!e) {
      problems.push(`${gid}: mapped paprikaId ${pid} missing from registry`);
      continue;
    }
    if (e.paprikaId !== pid) problems.push(`${gid}: registry paprikaId ${e.paprikaId} != coins ${pid}`);
    if (c.name != null && e.cgName !== c.name) problems.push(`${gid}: registry cgName ${JSON.stringify(e.cgName)} != coins ${JSON.stringify(c.name)}`);
    if (c.symbol != null && e.cgSymbol !== c.symbol) problems.push(`${gid}: registry cgSymbol ${JSON.stringify(e.cgSymbol)} != coins ${JSON.stringify(c.symbol)}`);
    if (c.snapshotMcapUsd != null && e.cgSnapshotMcapUsd !== c.snapshotMcapUsd)
      problems.push(`${gid}: registry cgSnapshotMcapUsd ${e.cgSnapshotMcapUsd} != coins ${c.snapshotMcapUsd}`);
  }
  for (const e of registryEntries || []) {
    if (e && e.cgId && !seenCg.has(e.cgId)) problems.push(`${e.cgId}: registry entry has no mapped coin`);
  }
  return problems;
}
