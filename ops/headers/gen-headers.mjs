#!/usr/bin/env node
// gen-headers.mjs — W2-18 §18.5 安全响应头生成脚本（Node 标准库 only，零依赖）
//
// 用法：
//   node ops/headers/gen-headers.mjs [--variant=off|on] [--out=<path>]
//   node ops/headers/gen-headers.mjs --check [--variant=off|on] [--out=<path>]
//   node ops/headers/gen-headers.mjs --report-only [--out=ops/headers/_headers.report-only.txt]
//   node ops/headers/gen-headers.mjs --no-csp   （§18.9 应急：仅删 CSP 一行，其余头保留）
//
// 规则（PHASE2_PLAN.md W2-18）：
// - index.html 以字节流读入，不做任何规范化/换行转换（hash 对字节敏感）。
// - 提取全部无 src 的 <script> 块（含 type="application/ld+json" 的 JSON-LD 块）
//   与全部 <style> 块的原始字节，逐块算 SHA-256（Base64）拼入 CSP。
// - 审计闸门：检出内联事件属性 / javascript: / eval( / new Function / document.write(
//   任一 → 逐行报错并以非零退出，不写出任何产物。
// - style="…" 属性存在时（静态标记 + JS 生成 HTML 合计 >0），按 §18.1.2 例外决策
//   追加 style-src-attr 'unsafe-inline'（仅 attr、仅样式；style-src 本体永不放行），
//   并在产物中打 TODO-W2-18 标记待季度自查（W2-21）复核摘除。
// - 硬失败：0 个 script 块 / 任一行 >1,900 字符 / 渲染后残留 {{ 占位。
// - --check 只比对不写出；比对时忽略 generated 时间戳，其余字节须完全一致。
// - 变体即契约（§18.4）：--variant 默认 off（WA-OFF）。WA 未启用时禁止生成 WA-ON 上线。

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const INDEX_PATH = resolve(ROOT, "public", "index.html");
const TMPL_PATH = resolve(HERE, "_headers.tmpl");
const DEFAULT_OUT = resolve(ROOT, "public", "_headers");
const DEFAULT_REPORT_ONLY_OUT = resolve(HERE, "_headers.report-only.txt");

// §18.1.2 /data/* 分组 Cache-Control（模板变量 DATA_CACHE_CONTROL；与 W2-01 口径对齐，改版只改此处）
const DATA_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
const LINE_LIMIT = 1900;

// ---------- 参数 ----------
const args = process.argv.slice(2);
let variant = "off";
let check = false;
let noCsp = false;
let reportOnly = false;
let outPath = null;
for (const a of args) {
  if (a === "--check") check = true;
  else if (a === "--no-csp") noCsp = true;
  else if (a === "--report-only") reportOnly = true;
  else if (a.startsWith("--variant=")) variant = a.slice("--variant=".length);
  else if (a.startsWith("--out=")) outPath = resolve(ROOT, a.slice("--out=".length));
  else {
    console.error(`未知参数：${a}`);
    process.exit(2);
  }
}
if (variant !== "off" && variant !== "on") {
  console.error(`--variant 只接受 off|on，收到：${variant}`);
  process.exit(2);
}
if (!outPath) outPath = reportOnly ? DEFAULT_REPORT_ONLY_OUT : DEFAULT_OUT;
const VARIANT_LABEL = variant === "on" ? "WA-ON" : "WA-OFF";

function fail(msg) {
  console.error(`[gen-headers] 失败：${msg}`);
  process.exit(1);
}

// ---------- 字节级读入与块提取 ----------
// latin1 解码保证字符串下标与字节下标 1:1 对齐，切片后按 latin1 回编即原始字节，hash 不失真。
const indexBuf = readFileSync(INDEX_PATH);
const doc = indexBuf.toString("latin1");
const indexSha256 = createHash("sha256").update(indexBuf).digest("hex");

function extractBlocks() {
  const scripts = [];
  const styles = [];
  const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(doc)) !== null) {
    const kind = m[1].toLowerCase();
    const attrs = m[2] || "";
    const body = Buffer.from(m[3], "latin1");
    const offset = m.index;
    if (kind === "script") {
      if (/(?:^|\s)src\s*=/i.test(attrs)) continue; // 外置脚本走 'self'，不算 hash
      const type = (attrs.match(/type\s*=\s*"([^"]*)"/i) || [])[1] || "";
      scripts.push({ body, offset, type });
    } else {
      styles.push({ body, offset });
    }
  }
  return { scripts, styles };
}

const { scripts, styles } = extractBlocks();

// 与脚本/样式内容剥离后的纯标记文本（审计事件属性、style 属性用，避免把 JS 字符串误判为标记属性）
const markupOnly = doc
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (m0) => m0.slice(0, m0.indexOf(">") + 1) + "</script>")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (m0) => m0.slice(0, m0.indexOf(">") + 1) + "</style>");

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}
function excerpt(text, offset) {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return text.slice(start, end === -1 ? text.length : end).trim().slice(0, 160);
}

// ---------- 审计闸门（§18.1.2 前提审计，任一命中即非零退出、逐行报错、不写产物） ----------
const auditErrors = [];
function scanAll(text, re, label, scope) {
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    auditErrors.push(`[${label}] ${scope} 第 ${lineOf(text, m.index)} 行：${excerpt(text, m.index)}`);
  }
}
// 内联事件属性（onclick= 等）：只扫标记区——hash 覆盖不了事件属性，放行即防护塌方，必须先重构
scanAll(markupOnly, /\son[a-z]+\s*=/gi, "内联事件属性", "index.html");
// javascript: URL：全文扫（标记与脚本体都不许出现）
scanAll(doc, /javascript\s*:/gi, "javascript: URL", "index.html");
// eval / new Function / document.write：扫 script 块内容（'unsafe-eval' 永不放行）
for (const s of scripts) {
  const bodyText = s.body.toString("latin1");
  scanAll(bodyText, /\beval\s*\(/g, "eval(", "script 块");
  scanAll(bodyText, /new\s+Function\s*\(/g, "new Function", "script 块");
  scanAll(bodyText, /document\s*\.\s*write\s*\(/g, "document.write(", "script 块");
}
if (auditErrors.length > 0) {
  console.error(`[gen-headers] 审计闸门未通过（${auditErrors.length} 处），不生成任何产物：`);
  for (const e of auditErrors) console.error(`  ${e}`);
  console.error("[gen-headers] 处置：先按 §18.1.2 做等价重构（addEventListener 等），严禁用放行指令解决。");
  process.exit(1);
}
if (scripts.length === 0) {
  fail("提取到 0 个 script 块——提取逻辑疑似失效，拒绝生成「全站脚本皆被拦」的策略。");
}

// ---------- style 属性清单与例外决策（§18.1.2） ----------
const STYLE_ATTR_RE = /\sstyle\s*=\s*("[^"]*"|'[^']*')/g;
const styleAttrMarkup = (markupOnly.match(STYLE_ATTR_RE) || []).length;
const styleAttrInScripts = scripts.reduce(
  (n, s) => n + (s.body.toString("latin1").match(STYLE_ATTR_RE) || []).length,
  0
);
const styleAttrException = styleAttrMarkup + styleAttrInScripts > 0;

// ---------- CSP 拼装（§18.1.2 逐指令定版） ----------
const sha256Token = (buf) => `'sha256-${createHash("sha256").update(buf).digest("base64")}'`;
const scriptHashes = scripts.map((s) => sha256Token(s.body)).join(" ");
const styleHashes = styles.map((s) => sha256Token(s.body)).join(" ");
const scriptSrc = `'self' ${scriptHashes}` + (variant === "on" ? " https://static.cloudflareinsights.com" : "");
const styleSrc = `'self' ${styleHashes}`;
const styleAttrSuffix = styleAttrException ? "; style-src-attr 'unsafe-inline'" : "";
const connectSrc = "'self'" + (variant === "on" ? " https://cloudflareinsights.com" : "");
const csp =
  `default-src 'none'; script-src ${scriptSrc}; style-src ${styleSrc}${styleAttrSuffix}; ` +
  `img-src 'self' data:; font-src 'self'; connect-src ${connectSrc}; base-uri 'none'; ` +
  `form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; ` +
  `manifest-src 'self'; upgrade-insecure-requests`;

// ---------- 模板渲染 ----------
const tmpl = readFileSync(TMPL_PATH, "utf8");
const cspHeaderName = reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
const todoLine = styleAttrException
  ? `# TODO-W2-18: style-src-attr 'unsafe-inline' 为过渡例外（审计实测 style 属性：静态标记 ${styleAttrMarkup} 处 + JS 生成 HTML ${styleAttrInScripts} 处）；` +
    `style-src 本体永不放行 'unsafe-inline'。纳入 W2-21 季度自查复核：属性内聚进 <style> 块后删除本例外与本行。`
  : null;

const renderedLines = [];
for (const line of tmpl.split("\n")) {
  if (line.trim() === "{{CSP_HEADER_LINE}}") {
    if (!noCsp) renderedLines.push(`  ${cspHeaderName}: ${csp}`);
    continue; // --no-csp 应急：整行删除（§18.9），其余低风险头保留
  }
  if (line.trim() === "{{STYLE_ATTR_TODO_LINE}}") {
    if (todoLine) renderedLines.push(todoLine);
    continue;
  }
  renderedLines.push(
    line
      .replaceAll("{{VARIANT}}", VARIANT_LABEL + (reportOnly ? "+report-only" : "") + (noCsp ? "+no-csp" : ""))
      .replaceAll("{{GENERATED_AT}}", new Date().toISOString())
      .replaceAll("{{INDEX_SHA256}}", indexSha256)
      .replaceAll("{{DATA_CACHE_CONTROL}}", DATA_CACHE_CONTROL)
  );
}
const output = renderedLines.join("\n");

// ---------- 硬断言 ----------
if (output.includes("{{")) fail("渲染后仍残留 {{ 占位符，模板与脚本不匹配。");
for (const [i, line] of output.split("\n").entries()) {
  if (line.length > LINE_LIMIT) {
    fail(`第 ${i + 1} 行 ${line.length} 字符 > ${LINE_LIMIT} 上限（Pages _headers 每行 ≤2,000，留安全边际）。`);
  }
}

// ---------- --check / 写出 ----------
const normalize = (t) => t.replace(/generated: [^;]+;/, "generated: <ts>;");
if (check) {
  if (!existsSync(outPath)) fail(`--check：${outPath} 不存在，请先运行生成。`);
  const existing = readFileSync(outPath, "utf8");
  if (normalize(existing) === normalize(output)) {
    console.log(`[gen-headers] --check 通过：${outPath} 与当前 index.html（${VARIANT_LABEL}${reportOnly ? "+report-only" : ""}${noCsp ? "+no-csp" : ""}）一致。`);
    process.exit(0);
  }
  const a = normalize(existing).split("\n");
  const b = normalize(output).split("\n");
  console.error(`[gen-headers] --check 不一致：${outPath} 与按当前 index.html 生成的结果不同：`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`  第 ${i + 1} 行 现有：${a[i] ?? "<无此行>"}`);
      console.error(`  第 ${i + 1} 行 应为：${b[i] ?? "<无此行>"}`);
    }
  }
  console.error("[gen-headers] 处置：运行 node ops/headers/gen-headers.mjs 重新生成（禁手改 _headers）。");
  process.exit(1);
}

writeFileSync(outPath, output);
console.log(`[gen-headers] 已生成 ${outPath}`);
console.log(`  变体：${VARIANT_LABEL}${reportOnly ? "（Report-Only 预演）" : ""}${noCsp ? "（--no-csp 应急：无 CSP 行）" : ""}`);
console.log(`  index.html：${indexBuf.length} 字节 sha256=${indexSha256}`);
console.log(
  `  script 块 ${scripts.length} 个（${scripts.map((s) => `${s.type || "inline"}/${s.body.length}B`).join(", ")}），style 块 ${styles.length} 个（${styles.map((s) => `${s.body.length}B`).join(", ")}）`
);
console.log(
  `  style 属性：静态标记 ${styleAttrMarkup} 处 + JS 生成 ${styleAttrInScripts} 处 → style-src-attr 例外${styleAttrException ? "已启用（TODO-W2-18）" : "未触发"}`
);
if (!noCsp) console.log(`  CSP 长度：${csp.length} 字符（上限 ${LINE_LIMIT}）`);
