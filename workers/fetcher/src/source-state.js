// source-state.js — W2-03 §3 整表熔断切换状态机（纯逻辑，可单测）
// 状态存 KV v1:config:source-state；activeProvider 决定本 run 抓谁。
// PAPRIKA_ENABLED=false 时强制 coinpaprika 无效（见 resolveProvider 的告警分支）。
import { SOURCE_SWITCH } from "../../../shared/board-schema.js";

export function emptySourceState(nowMs) {
  return {
    state: "CG_PRIMARY", // CG_PRIMARY | CG_DEGRADED | PAPRIKA_ACTIVE
    activeProvider: "coingecko",
    cgConsecutiveFailures: 0,
    paprikaConsecutiveFailures: 0,
    enteredPaprikaAt: null,
    cooldownUntil: null, // ms epoch：静默期截止
    probeRunCounter: 0, // Paprika 态 run 计数（探针节奏）
    probeConsecutiveSuccesses: 0,
    justReturned: false, // 刚回切 CG：首 run 失败即切回且静默期减半
    paprikaQuotaExhausted: false,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function paprikaEnabled(env) {
  return String(env && env.PAPRIKA_ENABLED) === "true";
}

// 决定本 run 的 provider。返回 {provider, probeCg, warnings[]}
// probeCg=true 表示 Paprika 态下本 run 顺带探一次 CG markets（不写 blob，只记账）。
export function resolveProvider(env, state, nowMs) {
  const warnings = [];
  const forced = String((env && env.BOARD_SOURCE) || "auto");
  if (!paprikaEnabled(env)) {
    if (forced === "coinpaprika") {
      warnings.push("BOARD_SOURCE=coinpaprika ignored: PAPRIKA_ENABLED=false (W2-03 §3 人工覆盖约束)");
    }
    return { provider: "coingecko", probeCg: false, warnings };
  }
  if (state && state.paprikaQuotaExhausted && forced !== "coingecko") {
    // Paprika 额度锁定：回 CG（探针成功与否另行判断），不再空撞 Paprika
    return { provider: "coingecko", probeCg: false, warnings };
  }
  if (forced === "coingecko") return { provider: "coingecko", probeCg: false, warnings };
  if (forced === "coinpaprika") return { provider: "coinpaprika", probeCg: false, warnings };
  // auto
  if (state && state.state === "PAPRIKA_ACTIVE") {
    const counter = (state.probeRunCounter || 0) + 1;
    const probeCg = counter % SOURCE_SWITCH.probeEveryRuns === 0;
    return { provider: "coinpaprika", probeCg, warnings };
  }
  return { provider: "coingecko", probeCg: false, warnings };
}

// run 结果落账：返回新 state（调用方负责写 KV，仅迁移/计数变化时写）。
// outcome: {provider, ok, isProbe?, coverageRatio?, retryAfterSec?, quotaExhausted?, quotaMode?}
export function applyOutcome(state, outcome, nowMs) {
  const s = { ...(state || emptySourceState(nowMs)) };
  const P = SOURCE_SWITCH;
  if (outcome.isProbe) {
    // CG 探针结果（Paprika 态）：只累积，不直接迁移（迁移在下方统一判定）
    if (outcome.ok && outcome.coverageRatio != null && outcome.coverageRatio >= P.probeCoverageMin) {
      s.probeConsecutiveSuccesses = (s.probeConsecutiveSuccesses || 0) + 1;
    } else if (!outcome.ok || outcome.coverageRatio != null) {
      s.probeConsecutiveSuccesses = 0;
    }
    maybeReturnToCg(s, nowMs);
    s.updatedAt = new Date(nowMs).toISOString();
    return s;
  }
  if (outcome.provider === "coingecko") {
    if (outcome.ok) {
      s.cgConsecutiveFailures = 0;
      s.justReturned = false;
      if (s.state !== "CG_PRIMARY") {
        s.state = "CG_PRIMARY";
        s.activeProvider = "coingecko";
      }
    } else {
      s.cgConsecutiveFailures = (s.cgConsecutiveFailures || 0) + 1;
      if (s.justReturned) {
        // 回切首 run 即失败 → 立即切回 Paprika，静默期减半
        enterPaprika(s, nowMs, P.cooldownAfterFailedReturnMin);
      } else if (
        s.cgConsecutiveFailures >= P.failThreshold ||
        (outcome.retryAfterSec != null && outcome.retryAfterSec > P.retryAfterImmediateSwitchSec) ||
        outcome.quotaMode === "critical"
      ) {
        enterPaprika(s, nowMs, P.cooldownMin);
      } else {
        s.state = "CG_DEGRADED";
        s.activeProvider = "coingecko";
      }
    }
  } else if (outcome.provider === "coinpaprika") {
    if (s.state === "PAPRIKA_ACTIVE") s.probeRunCounter = (s.probeRunCounter || 0) + 1;
    if (outcome.ok) {
      s.paprikaConsecutiveFailures = 0;
    } else {
      s.paprikaConsecutiveFailures = (s.paprikaConsecutiveFailures || 0) + 1;
      if (outcome.quotaExhausted) s.paprikaQuotaExhausted = true;
    }
    maybeReturnToCg(s, nowMs);
  }
  s.updatedAt = new Date(nowMs).toISOString();
  return s;
}

function enterPaprika(s, nowMs, cooldownMin) {
  s.state = "PAPRIKA_ACTIVE";
  s.activeProvider = "coinpaprika";
  s.enteredPaprikaAt = new Date(nowMs).toISOString();
  s.cooldownUntil = nowMs + cooldownMin * 60 * 1000;
  s.probeRunCounter = 0;
  s.probeConsecutiveSuccesses = 0;
  s.justReturned = false;
}

function maybeReturnToCg(s, nowMs) {
  if (s.state !== "PAPRIKA_ACTIVE") return;
  if (s.cooldownUntil != null && nowMs < s.cooldownUntil) return; // 静默期内只累积不迁移
  if ((s.probeConsecutiveSuccesses || 0) >= SOURCE_SWITCH.probeSuccessNeeded) {
    s.state = "CG_PRIMARY";
    s.activeProvider = "coingecko";
    s.cgConsecutiveFailures = 0;
    s.probeConsecutiveSuccesses = 0;
    s.probeRunCounter = 0;
    s.justReturned = true;
  }
}
