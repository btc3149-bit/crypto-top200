// shared/board-schema.js — W2-01/W2-02/W2-03 共用契约层
// fetcher（写）与 Pages Function（读）共用同一份 blob 结构定义、归一化、
// 覆盖率计算与新鲜度分级，杜绝两处口径漂移（PHASE2_PLAN 第二章定版）。
// 纯函数、无平台 API 依赖：Workers / Pages Functions / Node 测试均可直接 import。

export const SCHEMA_VERSION = 1;
export const KV_KEYS = {
  current: "v1:board:current",
  shadow: "v1:board:shadow",
  currentPrev: "v1:board:current:prev",
  shadowPrev: "v1:board:shadow:prev",
  health: "v1:meta:health",
  sourceState: "v1:config:source-state",
};
export const COVERAGE_RATIO = 0.94; // 沿用一期门禁
export const SNAPSHOT_DATE = "2026-11-08";

// W2-02 §2 新鲜度阈值（秒）：集中一处，调参只改此处。
export const FRESHNESS_THRESHOLDS = {
  l0MaxSec: 900, // ≤15min live
  l1MaxSec: 1800, // ≤30min delayed
  l2MaxSec: 21600, // ≤6h stale（硬上限）， beyond → L3 snapshot
  globalStaleSec: 3600, // global 子状态独立阈值
  globalNullSec: 21600, // global 年龄 >6h 置 null
  clockSkewToleranceSec: 60, // staleAgeSec < -60s 记 CLOCK_SKEW 并钳制为 0
};
// quotaMode → 下一次预期抓取间隔（秒），供 freshness.nextExpectedFetchAt
export const FETCH_INTERVAL_SEC = { normal: 600, saving: 900, critical: 1800 };

// W2-03 §3 熔断切换参数（集中常量，演练加速后须恢复定版值单独提交）
export const SOURCE_SWITCH = {
  failThreshold: 3, // CG 连续 run 级失败 3 次（≈30min）切 Paprika
  cooldownMin: 60, // 切入 Paprika 后静默期（分钟）
  cooldownAfterFailedReturnMin: 30, // 回切首 run 即失败时静默期减半
  probeEveryRuns: 3, // Paprika 态下每 3 个 run 探一次 CG（≈30min）
  probeSuccessNeeded: 3, // 探针连续成功 3 次才回切
  probeCoverageMin: 0.98, // 回切探针覆盖率门槛（严于发布门禁）
  publishCoverageMin: COVERAGE_RATIO, // 整表发布门禁 0.94
  retryAfterImmediateSwitchSec: 1800, // 429 Retry-After >30min 直接切源
};

export function toIso(ms) {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function toMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function computeCoverage(expectedIds, returnedIdSet) {
  const expected = expectedIds.length;
  const missingIds = expectedIds.filter((id) => !returnedIdSet.has(id));
  const returned = expected - missingIds.length;
  return { expected, returned, missingIds, ratio: expected ? returned / expected : 0 };
}

// 自现行 board.js fetchUpstreamInternal 抽取的字段映射，保持行结构同构：
// 现行 coins 字典值 {price, mcapUsd, rank, change24h} → blob rows 数组元素
// {id, price, mcapUsd, rank, change24h, _src}（_src 仅供 fetcher 内部断言，组装对外时剥除）。
export function normalizeCgMarkets(markets, expectedIds) {
  const byId = new Map();
  if (Array.isArray(markets)) {
    for (const m of markets) {
      if (!m || !m.id) continue;
      byId.set(m.id, {
        id: m.id,
        price: m.current_price ?? null,
        mcapUsd: m.market_cap ?? null,
        rank: m.market_cap_rank ?? null,
        change24h:
          m.price_change_percentage_24h_in_currency != null
            ? m.price_change_percentage_24h_in_currency
            : m.price_change_percentage_24h ?? null,
        _src: "coingecko",
      });
    }
  }
  const coverage = computeCoverage(expectedIds, new Set(byId.keys()));
  // rows 只含期望列表内的币（与现行 coverage 口径一致：列表外 id 不计入）
  const rows = expectedIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  return { rows, coverage };
}

// CoinGecko /global 归一化（兼容现行 v1 字段名 totalMcapUsd/btcDominance 与
// 方案 blob 字段名 totalMarketCapUsd/btcDominancePct 两种输入）。
export function normalizeCgGlobal(rawData, asOfMs) {
  const g = rawData && rawData.data ? rawData.data : rawData || {};
  return {
    totalMarketCapUsd: g.total_market_cap ? g.total_market_cap.usd ?? null : g.totalMarketCapUsd ?? g.totalMcapUsd ?? null,
    btcDominancePct: g.market_cap_percentage ? g.market_cap_percentage.btc ?? null : g.btcDominancePct ?? g.btcDominance ?? null,
    totalMcapChange24h:
      g.market_cap_change_percentage_24h_usd != null
        ? g.market_cap_change_percentage_24h_usd
        : g.totalMcapChange24h ?? null,
    asOf: toIso(asOfMs),
  };
}

// CoinPaprika /v1/tickers 归一化（W2-03 §5 字段映射表）
// W5-01（F5-01）形变全链统一：币种元素标准形为 fetcher COINS 的 {id, paprikaId}。
// 旧实现按 {coingeckoId, paprikaId} 读 c.coingeckoId，与 COINS 的 {id,...} 永不相遇，
// 备源一启用覆盖率恒 0、missingIds 全 undefined（假备源）。现以 c.id 为准，
// c.coingeckoId 仅作旧形兼容别名；missingIds 恒为真实 id。
export function normalizePaprikaTickers(tickers, coins) {
  // coins: [{id, paprikaId}]；映射缺失（paprikaId=null）的币直接计 missing。
  const coinId = (c) => (c ? (c.id != null ? c.id : c.coingeckoId) : undefined);
  const byPaprikaId = new Map();
  if (Array.isArray(tickers)) {
    for (const t of tickers) {
      if (t && t.id) byPaprikaId.set(t.id, t);
    }
  }
  const rows = [];
  const hit = new Set();
  for (const c of coins) {
    if (!c || !c.paprikaId) continue;
    const t = byPaprikaId.get(c.paprikaId);
    if (!t) continue;
    const usd = (t.quotes && t.quotes.USD) || {};
    const gid = coinId(c);
    rows.push({
      id: gid,
      price: usd.price ?? null,
      mcapUsd: usd.market_cap ?? null,
      rank: t.rank ?? null,
      change24h: usd.percent_change_24h ?? null,
      _src: "coinpaprika",
    });
    hit.add(gid);
  }
  const coverage = computeCoverage(
    coins.map((c) => coinId(c)),
    hit
  );
  return { rows, coverage };
}

// CoinPaprika /v1/global 归一化
export function normalizePaprikaGlobal(raw, asOfMs) {
  const g = raw || {};
  return {
    totalMarketCapUsd: g.market_cap_usd ?? null,
    btcDominancePct: g.bitcoin_dominance_percentage ?? g.bitcoin_dominance ?? null,
    totalMcapChange24h: g.market_cap_change_24h ?? null,
    asOf: toIso(asOfMs),
  };
}

// W2-03 §4.2 永不拼盘断言 + blob 组装单入口：
// 入参只能是单一 provider 的单次完整结果；rows 的 _src 必须全等于 source。
export function buildBlob({ source, fetchRunId, fetchedAtMs, rows, coverage, global, fetchMeta, healthSummary }) {
  if (source !== "coingecko" && source !== "coinpaprika") {
    throw new Error(`buildBlob: unknown source ${source}`);
  }
  for (const r of rows || []) {
    if (!r || r._src !== source) {
      throw new Error(`buildBlob: mixed-source row rejected (row _src=${r && r._src}, blob source=${source})`);
    }
    if (r.fetchRunId != null && fetchRunId != null && r.fetchRunId !== fetchRunId) {
      throw new Error("buildBlob: row fetchRunId mismatch rejected");
    }
  }
  if (global && global._src != null && global._src !== source) {
    throw new Error("buildBlob: cross-source global rejected (拼盘)");
  }
  const iso = toIso(fetchedAtMs);
  const cleanRows = (rows || []).map(({ _src, fetchRunId: _fr, ...rest }) => rest);
  const cleanGlobal = global ? (({ _src, ...rest }) => rest)(global) : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    source,
    fetchRunId: fetchRunId || null,
    fetchedAt: iso,
    marketsUpdatedAt: iso,
    fetchMeta: fetchMeta || null,
    coverage: coverage
      ? { expected: coverage.expected, returned: coverage.returned, missingIds: coverage.missingIds }
      : null,
    rows: cleanRows,
    global: cleanGlobal,
    healthSummary: healthSummary || null,
  };
}

// blob 结构校验。返回 {ok, errors[], warnings[]}。
// W2-02 兼容判定：缺 global.asOf 的旧 blob 给 warning 而非 error（灰度期容忍，G4 后移除）。
export function validateBlob(blob) {
  const errors = [];
  const warnings = [];
  if (!blob || typeof blob !== "object") return { ok: false, errors: ["blob_not_object"], warnings };
  if (blob.schemaVersion !== SCHEMA_VERSION) errors.push("schema_version");
  if (blob.source !== "coingecko" && blob.source !== "coinpaprika") errors.push("source");
  if (toMs(blob.fetchedAt) == null) errors.push("fetched_at");
  if (!Array.isArray(blob.rows)) errors.push("rows_not_array");
  if (!blob.coverage || typeof blob.coverage.expected !== "number" || typeof blob.coverage.returned !== "number") {
    errors.push("coverage");
  } else if (blob.coverage.expected > 0 && blob.coverage.returned / blob.coverage.expected < COVERAGE_RATIO) {
    errors.push("coverage_below_gate");
  }
  if (Array.isArray(blob.rows)) {
    for (const r of blob.rows) {
      if (!r || typeof r.id !== "string" || !("price" in r)) {
        errors.push("row_shape");
        break;
      }
    }
  }
  if (blob.global != null) {
    if (typeof blob.global !== "object") errors.push("global_shape");
    else if (!blob.global.asOf) warnings.push("global_missing_asof_legacy_compat");
  }
  return { ok: errors.length === 0, errors, warnings };
}

// W2-02 §2 状态机：纯时间驱动。返回 {staleAgeSec, level, mode, stale, clockSkew}
export function freshnessFor(fetchedAtMs, servedAtMs) {
  let ageSec = Math.floor((servedAtMs - fetchedAtMs) / 1000);
  let clockSkew = false;
  if (ageSec < -FRESHNESS_THRESHOLDS.clockSkewToleranceSec) clockSkew = true;
  if (ageSec < 0) ageSec = 0;
  const t = FRESHNESS_THRESHOLDS;
  if (ageSec <= t.l0MaxSec) return { staleAgeSec: ageSec, level: "L0", mode: "live", stale: false, clockSkew };
  if (ageSec <= t.l1MaxSec) return { staleAgeSec: ageSec, level: "L1", mode: "delayed", stale: true, clockSkew };
  if (ageSec <= t.l2MaxSec) return { staleAgeSec: ageSec, level: "L2", mode: "stale", stale: true, clockSkew };
  return { staleAgeSec: ageSec, level: "L3", mode: "snapshot", stale: true, clockSkew };
}

// global 子状态：独立于整表级别。返回 {global(可能为null), globalStale}
export function globalForContract(blobGlobal, servedAtMs) {
  if (!blobGlobal) return { global: null, globalStale: false };
  const asOfMs = toMs(blobGlobal.asOf);
  // 旧 blob 缺 asOf：兼容期按 blob 级处理，给值但标记 stale 未知→按不 stale? 定版：缺 asOf 时无法判定年龄，
  // 给出原值并附 asOf=null（前端显示无时间），不置 null。
  const out = {
    totalMcapUsd: blobGlobal.totalMarketCapUsd ?? blobGlobal.totalMcapUsd ?? null,
    btcDominance: blobGlobal.btcDominancePct ?? blobGlobal.btcDominance ?? null,
    totalMcapChange24h: blobGlobal.totalMcapChange24h ?? null,
    asOf: blobGlobal.asOf ?? null,
    stale: false,
  };
  if (asOfMs == null) return { global: out, globalStale: false };
  const ageSec = Math.max(0, Math.floor((servedAtMs - asOfMs) / 1000));
  if (ageSec > FRESHNESS_THRESHOLDS.globalNullSec) return { global: null, globalStale: true };
  out.stale = ageSec > FRESHNESS_THRESHOLDS.globalStaleSec;
  return { global: out, globalStale: out.stale };
}

// health 初始/归一化（W2-02 §3 全量字段；绝不包含任何 key/令牌片段）
export function emptyHealth(nowMs) {
  return {
    updatedAt: toIso(nowMs),
    status: "ok",
    alert: false,
    lastRunId: null,
    lastRunAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastError: null,
    lastUpstreamStatus: null,
    skipRunsRemaining: 0,
    quota: { month: null, creditsUsedEst: 0, quotaMode: "normal" },
    sourceState: null,
  };
}

export function healthStatusFor(consecutiveFailures) {
  if (consecutiveFailures >= 6) return { status: "down", alert: true };
  if (consecutiveFailures >= 3) return { status: "failing", alert: false };
  if (consecutiveFailures >= 1) return { status: "degraded", alert: false };
  return { status: "ok", alert: false };
}
