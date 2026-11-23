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
  // W5 legacy 实测计量（W4-02 计数键，2026-11-23 站长批准激活）：board.js Function
  // 唯一可写键，只记 legacy/dual 回源 credits（{month, credits, updatedAt}），见 board.js。
  legacyCredits: "v1:meta:legacy-credits",
};
// F7-29（第七期批 1 定版接口）：paprikaId 字段级校验——合法值仅 null（未映射）
// 或非空字符串且匹配 Paprika id 形态（小写字母/数字/连字符、至少一段连字符）。
// 数字/对象/空串均为畸形：解码层（前端 zip / board getIds）按定版只透传/只取
// coingeckoId 列、不做此校验；身份与计数口径一律经本接口判定，禁止再以 truthy
// 计数（数字/对象等真值畸形会被 truthy 误计入 mapped 数，与 F7-02 同源）。
export function isValidPaprikaId(v) {
  if (v === null) return true; // 未映射是合法状态
  return typeof v === "string" && /^[a-z0-9]+-[a-z0-9-]+$/.test(v);
}
export function countValidPaprikaMappings(coins) {
  if (!Array.isArray(coins)) return 0;
  return coins.filter((c) => c && typeof c.paprikaId === "string" && c.paprikaId !== "" && isValidPaprikaId(c.paprikaId)).length;
}

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
// F6-44 schema 侧对齐：saving 名义 15min 跳过线落在 */10 网格上实际为 20 分钟一抓
//（fetcher shouldSkipMarkets：age<15min 跳过 → 下一网格点 20min），故 saving=1200 与实际节奏一致。
export const FETCH_INTERVAL_SEC = { normal: 600, saving: 1200, critical: 1800 };

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

// F6-02 字段级门禁：行情数值字段的合理性上限（超出即视为上游形变/坏数据）。
// 取值远高于任何真实币种量级（单币价 <1e6、市值 <1e14、24h 量 <1e13），只拦
// 1e30/Infinity 一类明显坏值，不误伤真实数据。
export const FIELD_LIMITS = { priceMax: 1e12, mcapUsdMax: 1e18, volume24hMax: 1e18 };
// 数值字段清洗：只接受 typeof number 且有限、非负、不超过上限的数；
// 其余（字符串、NaN、Infinity、负数、超限）一律置 null。返回 {value, invalid}，
// invalid=true 表示「原值非 null 但被判坏」——调用方计数留痕，不得静默吞。
export function sanitizeMarketNumber(v, max) {
  if (v == null) return { value: null, invalid: false };
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max) return { value: v, invalid: false };
  return { value: null, invalid: true };
}

// F7-15 带符号数值清洗（change24h 等可正可负字段）：有限且 |v| ≤ maxAbs 才保留。
export const CHANGE24H_MAX_ABS = 1e6;
export function sanitizeSignedNumber(v, maxAbs) {
  if (v == null) return { value: null, invalid: false };
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= maxAbs) return { value: v, invalid: false };
  return { value: null, invalid: true };
}
// F7-15 rank 清洗：正整数（≤1e6）才保留，其余非 null 值置 null 并计数。
export function sanitizeRank(v) {
  if (v == null) return { value: null, invalid: false };
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1e6) return { value: v, invalid: false };
  return { value: null, invalid: true };
}

// 自现行 board.js fetchUpstreamInternal 抽取的字段映射，保持行结构同构：
// 现行 coins 字典值 {price, mcapUsd, rank, change24h, volume24h} → blob rows 数组元素
// {id, price, mcapUsd, rank, change24h, volume24h, _src}（_src 仅供 fetcher 内部断言，组装对外时剥除）。
// volume24h 为 W3-25 契约增量（上游同一响应 total_volume，纯新增、向后兼容）。
export function normalizeCgMarkets(markets, expectedIds) {
  const byId = new Map();
  // F6-02：price/mcapUsd/volume24h 字段级清洗计数（非数/负数/超限 → null 并计数）。
  // F7-15：change24h/rank 同步清洗，两源口径对齐（见 makeFieldCleaner）。
  const invalidFields = { price: 0, mcapUsd: 0, volume24h: 0, change24h: 0, rank: 0, total: 0 };
  const clean = makeFieldCleaner(invalidFields);
  if (Array.isArray(markets)) {
    for (const m of markets) {
      if (!m || !m.id) continue;
      byId.set(m.id, {
        id: m.id,
        price: clean.market(m.current_price ?? null, FIELD_LIMITS.priceMax, "price"),
        mcapUsd: clean.market(m.market_cap ?? null, FIELD_LIMITS.mcapUsdMax, "mcapUsd"),
        rank: clean.rank(m.market_cap_rank ?? null),
        change24h: clean.signed(
          m.price_change_percentage_24h_in_currency != null
            ? m.price_change_percentage_24h_in_currency
            : m.price_change_percentage_24h ?? null
        ),
        volume24h: clean.market(m.total_volume ?? null, FIELD_LIMITS.volume24hMax, "volume24h"),
        _src: "coingecko",
      });
    }
  }
  const coverage = computeCoverage(expectedIds, new Set(byId.keys()));
  // rows 只含期望列表内的币（与现行 coverage 口径一致：列表外 id 不计入）
  const rows = expectedIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  return { rows, coverage, invalidFields };
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

// F7-15 两源共用字段清洗器：market=非负上限（price/mcapUsd/volume24h）、
// signed=带符号上限（change24h）、rank=正整数。坏值置 null 并按字段计数，
// invalidFields 恒含 {price, mcapUsd, volume24h, change24h, rank, total}。
export function makeFieldCleaner(invalidFields) {
  const bump = (field, invalid) => {
    if (invalid) {
      invalidFields[field] = (invalidFields[field] || 0) + 1;
      invalidFields.total = (invalidFields.total || 0) + 1;
    }
  };
  return {
    market: (v, max, field) => {
      const r = sanitizeMarketNumber(v, max);
      bump(field, r.invalid);
      return r.value;
    },
    signed: (v) => {
      const r = sanitizeSignedNumber(v, CHANGE24H_MAX_ABS);
      bump("change24h", r.invalid);
      return r.value;
    },
    rank: (v) => {
      const r = sanitizeRank(v);
      bump("rank", r.invalid);
      return r.value;
    },
  };
}
export function emptyInvalidFields() {
  return { price: 0, mcapUsd: 0, volume24h: 0, change24h: 0, rank: 0, total: 0 };
}

// CoinPaprika /v1/tickers 归一化（W2-03 §5 字段映射表）
// W5-01（F5-01）形变全链统一：币种元素标准形为 fetcher COINS 的 {id, paprikaId}。
// 旧实现按 {coingeckoId, paprikaId} 读 c.coingeckoId，与 COINS 的 {id,...} 永不相遇，
// 备源一启用覆盖率恒 0、missingIds 全 undefined（假备源）。现以 c.id 为准，
// c.coingeckoId 仅作旧形兼容别名；missingIds 恒为真实 id。
export function normalizePaprikaTickers(tickers, coins) {
  // coins: [{id, paprikaId}]；映射缺失（paprikaId=null）的币直接计 missing。
  // F7-15：与 CG 路径同一清洗口径——price/mcapUsd/volume24h 走非负上限清洗、
  // change24h 带符号清洗、rank 正整数清洗；坏值置 null 并计入 invalidFields，
  // 不再透传脏值靠 validateBlob 整 blob 拒绝（单币坏字段不得拖垮整轮）。
  const invalidFields = emptyInvalidFields();
  const clean = makeFieldCleaner(invalidFields);
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
      price: clean.market(usd.price ?? null, FIELD_LIMITS.priceMax, "price"),
      mcapUsd: clean.market(usd.market_cap ?? null, FIELD_LIMITS.mcapUsdMax, "mcapUsd"),
      rank: clean.rank(t.rank ?? null),
      change24h: clean.signed(usd.percent_change_24h ?? null),
      volume24h: clean.market(usd.volume_24h ?? null, FIELD_LIMITS.volume24hMax, "volume24h"),
      _src: "coinpaprika",
    });
    hit.add(gid);
  }
  const coverage = computeCoverage(
    coins.map((c) => coinId(c)),
    hit
  );
  return { rows, coverage, invalidFields };
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

// F6-02：price 非 null 比例下限——低于此值视为上游大面积坏数据，整 blob 拒绝。
export const PRICE_NON_NULL_MIN_RATIO = 0.98;
// 第六期集成对齐（F6-02×F6-18）：比例门禁另设绝对宽容——null 价 ≤4 个时不整 run 拒绝。
// 生产 200 行口径下两者等价（2% = 4 个）；小样本/个别币无价（常态）不被比例误杀，
// 上游大面积 null（数十个）仍必触发。定版：count > 4 且 ratio < 0.98 才判 price_null_ratio；
// 例外：非 null 比例 <50%（多数行无价）属灾难形态，任何规模都拒绝（全 null rows 恒命中）。
export const PRICE_NULL_ABS_ALLOWANCE = 4;
export const PRICE_NULL_CATASTROPHE_RATIO = 0.5;

// blob 结构校验。返回 {ok, errors[], warnings[], stats}。
// stats.invalidFields 为字段级坏值计数（F6-02 留痕口径）；stats.nullPriceCount 为 price=null 行数。
// W2-02 兼容判定：缺 global.asOf 的旧 blob 给 warning 而非 error（灰度期容忍，G4 后移除）。
// F6-52 标记形态（定版，fetcher 侧据此消费）：global 关键字段全 null 时
// errors 含字符串 "global_all_null"（validateBlob ok=false）；fetcher 在写 blob 前
// 应据此沿用 prev global（含原 asOf），不得盖新鲜戳覆写。
export function validateBlob(blob) {
  const errors = [];
  const warnings = [];
  const stats = { invalidFields: { price: 0, mcapUsd: 0, volume24h: 0, change24h: 0, rank: 0, total: 0 }, nullPriceCount: 0, rowCount: 0, uniqueIdCount: 0 };
  if (!blob || typeof blob !== "object") return { ok: false, errors: ["blob_not_object"], warnings, stats };
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
    stats.rowCount = blob.rows.length;
    const ids = new Set();
    let shapeBad = false;
    let fieldBad = false;
    for (const r of blob.rows) {
      if (!r || typeof r.id !== "string" || !("price" in r)) {
        shapeBad = true;
        continue;
      }
      ids.add(r.id);
      // F6-02 字段级门禁：非 null 的 price/mcapUsd/volume24h 必须是有限非负且不超限的数。
      for (const [field, max] of [["price", FIELD_LIMITS.priceMax], ["mcapUsd", FIELD_LIMITS.mcapUsdMax], ["volume24h", FIELD_LIMITS.volume24hMax]]) {
        const chk = sanitizeMarketNumber(r[field] ?? null, max);
        if (chk.invalid) {
          stats.invalidFields[field] += 1;
          stats.invalidFields.total += 1;
          fieldBad = true;
        }
      }
      // F7-15：change24h/rank 两字段补类型门禁（此前两路均未清洗、此处亦不查，
      // 只靠前端 num() 兜底）：非 null 时 change24h 须有限数、rank 须正整数。
      if (r.change24h != null && sanitizeSignedNumber(r.change24h, CHANGE24H_MAX_ABS).invalid) {
        stats.invalidFields.change24h = (stats.invalidFields.change24h || 0) + 1;
        stats.invalidFields.total += 1;
        fieldBad = true;
      }
      if (r.rank != null && sanitizeRank(r.rank).invalid) {
        stats.invalidFields.rank = (stats.invalidFields.rank || 0) + 1;
        stats.invalidFields.total += 1;
        fieldBad = true;
      }
      if (r.price == null) stats.nullPriceCount += 1;
    }
    if (shapeBad) errors.push("row_shape");
    if (fieldBad) errors.push("row_field_invalid");
    stats.uniqueIdCount = ids.size;
    // F6-02：price 非 null 比例 <98%（且 null 数 >4，或非 null 比例 <50%）→ 整 blob 判 error（全 null rows 不再假绿）。
    const nonNullRatio = blob.rows.length > 0 ? (blob.rows.length - stats.nullPriceCount) / blob.rows.length : 1;
    if (blob.rows.length > 0 && nonNullRatio < PRICE_NON_NULL_MIN_RATIO && (stats.nullPriceCount > PRICE_NULL_ABS_ALLOWANCE || nonNullRatio < PRICE_NULL_CATASTROPHE_RATIO)) {
      errors.push("price_null_ratio");
    }
    // F6-04 交叉校验：coverage.returned 必须等于 rows 去重 id 数；
    // missingIds 必须与 rows 互补（不得含在场 id、并集须等于 expected 计数口径）。
    if (blob.coverage && typeof blob.coverage.returned === "number" && blob.coverage.returned !== ids.size) {
      errors.push("coverage_returned_mismatch");
    }
    if (blob.coverage && Array.isArray(blob.coverage.missingIds)) {
      const missing = new Set(blob.coverage.missingIds);
      const overlap = [...missing].some((id) => ids.has(id));
      const unionMismatch =
        typeof blob.coverage.expected === "number" && missing.size + ids.size !== blob.coverage.expected;
      if (overlap || unionMismatch) errors.push("coverage_missing_mismatch");
    }
  }
  if (blob.global != null) {
    if (typeof blob.global !== "object") errors.push("global_shape");
    else {
      if (!blob.global.asOf) warnings.push("global_missing_asof_legacy_compat");
      // F6-52：global 关键字段全 null → 可识别标记（见函数头定版说明）。
      const g = blob.global;
      const keyVals = [
        g.totalMarketCapUsd ?? g.totalMcapUsd ?? null,
        g.btcDominancePct ?? g.btcDominance ?? null,
        g.totalMcapChange24h ?? null,
      ];
      if (keyVals.every((v) => v == null)) errors.push("global_all_null");
    }
  }
  return { ok: errors.length === 0, errors, warnings, stats };
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
