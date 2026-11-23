#!/usr/bin/env node
// audit-deps.mjs — F7-46 可复现依赖漏洞审计（OSV 公共 API，无需凭证、零依赖）
//
// 背景：本环境 `npm audit` 被注册表策略 403（policy_denied）拒绝，第六期
// 「npm audit 0 漏洞」无法同法续证（PHASE7_REVIEW.md F7-46）。本脚本改走
// OSV（https://api.osv.dev）公共 API：从 package-lock.json 枚举全部 npm 包
// 与确切版本，批量 querybatch 查询，再逐条取漏洞明细汇总。
//
// 用法：
//   node scripts/audit-deps.mjs              # 联网审计；退出码：0=已审计且 0 漏洞，1=已审计且有漏洞，2=未完成审计（网络/上游错误）
//   node scripts/audit-deps.mjs --list       # 只枚举 lockfile 包清单（离线，不联网、不下结论）
//   node scripts/audit-deps.mjs --out=ops/security/audit-deps-YYYY-MM-DD.json
//   OSV_API_BASE=<本地桩地址> node scripts/audit-deps.mjs   # 测试用，覆盖 API 基址
//
// 纪律：网络或上游失败时以退出码 2 明确报「未审计」，绝不输出「0 漏洞」。
// 输出含审计日期（UTC）、工具名、lockfile 包总数与逐包漏洞明细，结果可复现
// （包按 name@version 排序、漏洞按 id 排序）。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = resolve(ROOT, "package-lock.json");
const API_BASE = (process.env.OSV_API_BASE || "https://api.osv.dev").replace(/\/$/, "");
const BATCH_SIZE = 500; // OSV querybatch 上限 1000，取 500 留余量

const args = process.argv.slice(2);
let listOnly = false;
let outPath = null;
for (const a of args) {
  if (a === "--list") listOnly = true;
  else if (a.startsWith("--out=")) outPath = resolve(ROOT, a.slice("--out=".length));
  else {
    console.error(`未知参数：${a}`);
    process.exit(2);
  }
}

// ---------- 从 package-lock.json 枚举包（lockfileVersion 3 的 packages 表） ----------
export function enumeratePackages(lock) {
  const pkgs = [];
  for (const [path, meta] of Object.entries(lock.packages || {})) {
    if (!path || !meta || !meta.version) continue; // 跳过根条目 ""
    const idx = path.lastIndexOf("node_modules/");
    if (idx === -1) continue;
    const name = path.slice(idx + "node_modules/".length);
    pkgs.push({ name, version: String(meta.version) });
  }
  pkgs.sort((a, b) => (a.name + "@" + a.version < b.name + "@" + b.version ? -1 : 1));
  // 同名同版本去重（嵌套 node_modules 可能重复出现同一包）
  return pkgs.filter((p, i) => i === 0 || p.name !== pkgs[i - 1].name || p.version !== pkgs[i - 1].version);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000), // 超时即按「未审计」退出 2，不无限等待
  });
  if (!res.ok) throw new Error(`POST ${url} → HTTP ${res.status}`);
  return res.json();
}
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

function severityOf(vuln) {
  // CVSS 向量取 database_specific / severity 字段做粗分级；取不到时记 unknown，不臆测。
  const sev = (vuln.severity || [])[0];
  return sev ? `${sev.type}:${sev.score}` : "unknown";
}

async function main() {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  const pkgs = enumeratePackages(lock);
  const auditedAt = new Date().toISOString();
  console.log(`[audit-deps] lockfile 枚举：${pkgs.length} 个包（package-lock.json，lockfileVersion=${lock.lockfileVersion}）`);
  if (listOnly) {
    for (const p of pkgs) console.log(`  ${p.name}@${p.version}`);
    console.log("[audit-deps] --list 模式：仅枚举，未联网、未审计，不下漏洞结论。");
    return 0;
  }

  const findings = [];
  try {
    for (let i = 0; i < pkgs.length; i += BATCH_SIZE) {
      const batch = pkgs.slice(i, i + BATCH_SIZE);
      const resp = await postJson(`${API_BASE}/v1/querybatch`, {
        queries: batch.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })),
      });
      const results = resp.results || [];
      for (let j = 0; j < batch.length; j++) {
        for (const v of results[j]?.vulns || []) {
          findings.push({ pkg: batch[j], id: v.id });
        }
      }
    }
    // 逐条取明细（summary / severity）；单条失败不中断整体，但如实标注 detail=unavailable
    for (const f of findings) {
      try {
        const detail = await getJson(`${API_BASE}/v1/vulns/${encodeURIComponent(f.id)}`);
        f.summary = detail.summary || "";
        f.severity = severityOf(detail);
        f.aliases = detail.aliases || [];
      } catch {
        f.summary = "";
        f.severity = "unknown";
        f.detail = "unavailable";
      }
    }
  } catch (e) {
    console.error(`[audit-deps] 未完成审计：OSV 查询失败（${e.message}）。本次结果不是「0 漏洞」，是「未审计」。`);
    console.error("[audit-deps] 补跑方法：在可直达 api.osv.dev 的环境运行 node scripts/audit-deps.mjs，并把工具与日期记入 ops/security/security-baseline.md。");
    return 2;
  }

  findings.sort((a, b) => (a.id < b.id ? -1 : 1));
  const report = {
    tool: "scripts/audit-deps.mjs (OSV api.osv.dev/v1/querybatch + /v1/vulns)",
    auditedAt,
    lockfile: "package-lock.json",
    packageCount: pkgs.length,
    vulnerabilityCount: findings.length,
    findings: findings.map((f) => ({
      package: `${f.pkg.name}@${f.pkg.version}`,
      id: f.id,
      severity: f.severity,
      summary: f.summary,
      aliases: f.aliases || [],
      ...(f.detail ? { detail: f.detail } : {}),
    })),
  };
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`[audit-deps] 报告已写入 ${outPath}`);
  }
  console.log(`[audit-deps] 审计完成（${auditedAt}）：${pkgs.length} 个包，漏洞 ${findings.length} 条。`);
  for (const f of report.findings) console.log(`  ${f.package} ${f.id} [${f.severity}] ${f.summary}`);
  return findings.length > 0 ? 1 : 0;
}

// 仅在直接执行时跑 main（被测试 import 时只用 enumeratePackages）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
