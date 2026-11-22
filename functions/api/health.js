// /api/health — Cloudflare Pages Function（W2-13 新增，只读健康端点）
// 服务端判定本站数据新鲜度与完整度，把「新鲜度」变成状态码语义，
// 供外部探针（UptimeRobot M4，见 ops/probe-config.md）以普通 HTTP 监控检查：
//   - 健康：HTTP 200 {"ok":true, ...}
//   - 不健康：HTTP 503 {"ok":false, ...}
//
// 判定口径（与 scripts/probe.sh 现行口径对齐，不新定阈值）：
//   1. 新鲜度：now − board.updatedAt ≤ 900 秒（probe.sh 注释定版：≤15 分钟 → PASS）；
//   2. 完整度：board.coverage.returned == board.coverage.expected 且 expected == 200
//      （方案 W2-13 定版口径「条数＝200」；expected 不写死在比较的左侧——
//       先读 board 实际返回的 coverage.expected，再要求 returned 与之相等，
//       最后要求 expected 本身为 200，防止期望值漂移时假绿）。
//   两条同时满足才 ok；board 不可达 / 非 200 / 非 JSON / 字段缺失一律 503。
// 第六期补强：F6-03 contractVersion===2 断言；F6-04 count===returned 断言；
// F6-05 ageSec<-60 或 board 自报 clockSkew → 503 board_clock_skew；
// F6-35 判龄优先用 board 的 staleAgeSec（fetchedAt 口径）；F6-38 内部 fetch 8s 超时。
//
// 安全与隐私：响应只含 mode / ageSec / coverage 等非敏感字段，不透传 coins 数据、
// 不含任何密钥或上游信息；响应不缓存（Cache-Control: no-store）。
// 方法语义：onRequestGet 承载 GET；onRequestHead 承载 HEAD（与 GET 同状态同头、无 body，
// 供 UptimeRobot HTTP 监控的默认 HEAD 探测使用——2026-11-12 M4 实测 405 后补）；
// onRequest 兜底其余方法 405。

import { SECURITY_HEADERS } from "../../shared/http.js"; // F6-33：与 board 共用单一定义

const FRESHNESS_THRESHOLD_SEC = 900; // 与 scripts/probe.sh 新鲜度阈值同值（≤15 分钟）
const EXPECTED_COUNT = 200; // 方案 W2-13 定版口径：条数＝200
const CLOCK_SKEW_TOLERANCE_SEC = 60; // 与 board-schema FRESHNESS_THRESHOLDS.clockSkewToleranceSec 对齐
const BOARD_FETCH_TIMEOUT_MS = 8000; // F6-38：内部 fetch /api/board 超时（5–10s 区间取 8s）

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

function methodNotAllowedResponse() {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      allow: "GET, HEAD",
    },
  });
}

// board.updatedAt 兼容两种形态：毫秒/秒级数值时间戳（现行 board.js 为 ms 数值）
// 与 ISO 字符串（probe.sh 同样双兼容，此处保持一致以防契约演进）。
function parseUpdatedAt(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw / 1000 : raw;
  }
  if (typeof raw === "string" && raw !== "") {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return asNum > 1e12 ? asNum / 1000 : asNum;
    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate)) return asDate / 1000;
  }
  return null;
}

async function handleGet(context) {
  const { request, env } = context;
  const checkedAt = new Date().toISOString();

  let board;
  try {
    const boardUrl = new URL("/api/board", request.url);
    // F6-38：内部 fetch 加 AbortController 超时（默认 8s；env 覆盖仅供测试），
    // board 挂起时 health 必须在超时内返回 503，不得跟着挂起。
    const timeoutMs =
      env && Number.isFinite(Number(env.HEALTH_BOARD_TIMEOUT_MS)) && Number(env.HEALTH_BOARD_TIMEOUT_MS) > 0
        ? Number(env.HEALTH_BOARD_TIMEOUT_MS)
        : BOARD_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
    }, timeoutMs);
    let res;
    try {
      res = await fetch(boardUrl.toString(), { headers: { accept: "application/json" }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return jsonResponse(
        { ok: false, reason: "board_http_error", boardStatus: res.status, checkedAt },
        503
      );
    }
    board = await res.json();
  } catch (e) {
    return jsonResponse({ ok: false, reason: "board_unreachable_or_invalid", checkedAt }, 503);
  }

  try {
    const coverage =
      board && board.coverage && typeof board.coverage === "object" ? board.coverage : null;
    const expected = coverage && typeof coverage.expected === "number" ? coverage.expected : null;
    const returned = coverage && typeof coverage.returned === "number" ? coverage.returned : null;
    const count = board && typeof board.count === "number" ? board.count : null;

    // F6-03：契约版本断言——非 v2 应答（错模式回落 legacy 等）不得判 ok。
    if (!board || board.contractVersion !== 2) {
      return jsonResponse(
        {
          ok: false,
          reason: "board_contract_version",
          mode: board && typeof board.mode === "string" ? board.mode : null,
          coverage: { expected, returned },
          checkedAt,
        },
        503
      );
    }

    // F6-35 判龄口径（定版）：优先用 board 应答自带的 staleAgeSec（按 fetchedAt 计算、
    // 与 board freshness 同源），不再只按 updatedAt（=marketsUpdatedAt）算龄——
    // 两字段不一致时以 freshness 口径为准，避免 board 判 live 而 health 判 503 的分裂。
    // staleAgeSec 缺失时才回退 updatedAt 算龄（兼容旧应答）。
    let ageSec = null;
    if (typeof board.staleAgeSec === "number" && Number.isFinite(board.staleAgeSec)) {
      ageSec = board.staleAgeSec;
    } else {
      const updatedAtSec = parseUpdatedAt(board.updatedAt);
      if (updatedAtSec != null) ageSec = Math.floor(Date.now() / 1000 - updatedAtSec);
    }

    if (ageSec == null || expected == null || returned == null) {
      return jsonResponse(
        {
          ok: false,
          reason: "board_fields_missing",
          mode: typeof board.mode === "string" ? board.mode : null,
          coverage: { expected, returned },
          checkedAt,
        },
        503
      );
    }

    // F6-05：未来时间戳假绿封堵——board 自报时钟偏移，或回退口径下 ageSec < -60，
    // 一律判 503、reason=board_clock_skew。
    const clockSkew =
      (board.freshness && board.freshness.clockSkew === true) || ageSec < -CLOCK_SKEW_TOLERANCE_SEC;
    if (clockSkew) {
      return jsonResponse(
        {
          ok: false,
          reason: "board_clock_skew",
          mode: typeof board.mode === "string" ? board.mode : null,
          ageSec,
          coverage: { expected, returned },
          checkedAt,
        },
        503
      );
    }

    const fresh = ageSec <= FRESHNESS_THRESHOLD_SEC;
    const complete = returned === expected && expected === EXPECTED_COUNT;
    // F6-04：count 必须与 coverage.returned 一致（count 缺失同样不判 ok）。
    const countConsistent = count != null && count === returned;
    const ok = fresh && complete && countConsistent;

    return jsonResponse(
      {
        ok,
        reason: ok ? undefined : !fresh ? "board_stale" : !complete ? "board_incomplete" : "board_count_mismatch",
        mode: typeof board.mode === "string" ? board.mode : null,
        ageSec,
        freshnessThresholdSec: FRESHNESS_THRESHOLD_SEC,
        coverage: { expected, returned },
        count,
        updatedAt: board.updatedAt,
        checkedAt,
      },
      ok ? 200 : 503
    );
  } catch (e) {
    return jsonResponse({ ok: false, reason: "health_check_error", checkedAt }, 503);
  }
}

// HEAD 与 GET 同判定：复用 handleGet 的状态与响应头，body 置空（HTTP 语义）。
async function handleHead(context) {
  const res = await handleGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}

export async function onRequestGet(context) {
  const method = context && context.request && context.request.method ? context.request.method : "GET";
  if (method !== "GET") return methodNotAllowedResponse();
  return handleGet(context);
}

export async function onRequestHead(context) {
  return handleHead(context);
}

export async function onRequest(context) {
  const method = context && context.request && context.request.method ? context.request.method : "GET";
  if (method === "GET") return handleGet(context);
  if (method === "HEAD") return handleHead(context);
  return methodNotAllowedResponse();
}
