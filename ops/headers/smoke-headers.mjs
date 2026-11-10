#!/usr/bin/env node
// smoke-headers.mjs — W2-18 §18.5 冒烟断言（对任意 base URL 运行，Node 标准库 only）
//
// 用法：
//   node ops/headers/smoke-headers.mjs <baseUrl> [--variant=off|on] [--only=S1,S2,S4] [--csp-header=report-only]
//
// 断言组：
//   S1 响应头存在性：/ 的 CSP 静态指令 + §18.1.3 全表逐项等于定版值、HSTS 只出现一次；
//      /data/coins.json 分组头组在位。
//   S2 线上字节自洽：抓线上 / 的 HTML 原始字节，用与 gen-headers.mjs 同一提取算法重算
//      hash 集合，断言与线上 CSP 头中的 hash 集合完全相等（专抓边缘改写/产物不一致）。
//   S3 功能探针：需无头浏览器（表格渲染行数、控制台零 CSP 违规）。本脚本为标准库 only、
//      无 puppeteer/CDP 客户端，恒为 SKIPPED 并注明须由协调者/浏览器侧补验，不得假报通过。
//   S4 API 头组：/api/board GET 期望 200、非 GET（POST）期望 405，两路均断言 §18.3 头组在位。
//   S5（仅 --variant=on 时有实质内容）：beacon 证据需浏览器 Network 面板（见 §18.4-2），
//      本脚本只能查注入痕迹，RUM 204 恒为 SKIPPED 待浏览器侧补验。
//
// 退出码：任一 FAIL → 1；SKIP 不影响退出码。

import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) || "").replace(/\/+$/, "");
if (!base) {
  console.error("用法：node ops/headers/smoke-headers.mjs <baseUrl> [--variant=off|on] [--only=S1,S2,S4] [--csp-header=report-only]");
  process.exit(2);
}
const variant = (args.find((a) => a.startsWith("--variant=")) || "--variant=off").split("=")[1];
const onlyArg = (args.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim().toUpperCase())) : null;
const cspHeaderName = args.includes("--csp-header=report-only")
  ? "content-security-policy-report-only"
  : "content-security-policy";
const want = (id) => !only || only.has(id);

let failures = 0;
const ok = (cond, label, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
const skip = (label, reason) => console.log(`  SKIP ${label} — ${reason}`);

// 与 gen-headers.mjs 同一提取算法：latin1 保持字节下标对齐，提取无 src 的 script 块与全部 style 块
function extractHashes(buf) {
  const doc = buf.toString("latin1");
  const scripts = [];
  const styles = [];
  const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(doc)) !== null) {
    const kind = m[1].toLowerCase();
    const attrs = m[2] || "";
    if (kind === "script" && /(?:^|\s)src\s*=/i.test(attrs)) continue;
    const token = `'sha256-${createHashB64(Buffer.from(m[3], "latin1"))}'`;
    (kind === "script" ? scripts : styles).push(token);
  }
  return { scripts, styles };
}
function createHashB64(buf) {
  return createHash("sha256").update(buf).digest("base64");
}
function cspDirective(csp, name) {
  const seg = csp.split(";").map((s) => s.trim()).find((s) => s === name || s.startsWith(name + " "));
  return seg || "";
}
const hashTokens = (seg) => (seg.match(/'sha256-[^']+'/g) || []).sort();
const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  console.log(`[smoke-headers] base=${base} variant=WA-${variant.toUpperCase()} cspHeader=${cspHeaderName}`);

  let homeRes = null;
  let homeBuf = null;
  if (want("S1") || want("S2") || want("S5")) {
    homeRes = await fetch(base + "/", { redirect: "follow" });
    homeBuf = Buffer.from(await homeRes.arrayBuffer());
  }

  if (want("S1")) {
    console.log("S1 响应头存在性（/ 与 /data/*）：");
    ok(homeRes.status === 200, "GET / 状态 200", `实际 ${homeRes.status}`);
    const h = homeRes.headers;
    const csp = h.get(cspHeaderName) || "";
    ok(csp.length > 0, `CSP 头（${cspHeaderName}）存在`);
    ok(cspDirective(csp, "default-src") === "default-src 'none'", "default-src 'none'");
    ok(cspDirective(csp, "script-src").startsWith("script-src 'self'"), "script-src 以 'self' 开头");
    ok(!cspDirective(csp, "script-src").includes("'unsafe-inline'"), "script-src 无 'unsafe-inline'");
    ok(!csp.includes("'unsafe-eval'"), "全 CSP 无 'unsafe-eval'");
    ok(cspDirective(csp, "frame-ancestors") === "frame-ancestors 'none'", "frame-ancestors 'none'");
    ok(csp.includes("upgrade-insecure-requests"), "upgrade-insecure-requests 在位");
    if (variant === "on") {
      ok(cspDirective(csp, "script-src").includes("https://static.cloudflareinsights.com"), "WA-ON：script-src 放行 beacon 域");
      ok(cspDirective(csp, "connect-src").includes("https://cloudflareinsights.com"), "WA-ON：connect-src 放行 RUM 域");
    } else {
      ok(!csp.includes("cloudflareinsights"), "WA-OFF：CSP 不放行 cloudflareinsights（变体即契约）");
    }
    const hsts = h.get("strict-transport-security");
    ok(hsts === "max-age=31536000", "HSTS 恰一次且等于定版值", `实际 ${JSON.stringify(hsts)}`);
    const exact = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-xss-protection": "0",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
    };
    for (const [k, v] of Object.entries(exact)) {
      ok(h.get(k) === v, `${k} 等于定版值`, `实际 ${JSON.stringify(h.get(k))}`);
    }
    const dataRes = await fetch(base + "/data/coins.json");
    const dh = dataRes.headers;
    ok((dh.get("content-type") || "").startsWith("application/json"), "/data/coins.json Content-Type 为 JSON", `实际 ${dh.get("content-type")}`);
    ok(dh.get("x-content-type-options") === "nosniff", "/data/* nosniff");
    ok(dh.get("cross-origin-resource-policy") === "same-origin", "/data/* CORP same-origin");
    ok(
      dh.get("cache-control") === "public, max-age=60, stale-while-revalidate=300",
      "/data/* Cache-Control 等于定版值",
      `实际 ${JSON.stringify(dh.get("cache-control"))}`
    );
  }

  if (want("S2")) {
    console.log("S2 线上字节自洽（线上 HTML 重算 hash vs 线上 CSP）：");
    const csp = homeRes.headers.get(cspHeaderName) || "";
    const live = extractHashes(homeBuf);
    const cspScript = hashTokens(cspDirective(csp, "script-src"));
    const cspStyle = hashTokens(cspDirective(csp, "style-src"));
    ok(sameSet([...live.scripts].sort(), cspScript), "script hash 集合完全相等", `线上重算 ${live.scripts.length} 个 / CSP ${cspScript.length} 个`);
    ok(sameSet([...live.styles].sort(), cspStyle), "style hash 集合完全相等", `线上重算 ${live.styles.length} 个 / CSP ${cspStyle.length} 个`);
  }

  if (want("S3")) {
    console.log("S3 功能探针：");
    skip("S3 无头浏览器探针", "本环境无 Chrome 且脚本为标准库 only（无 CDP 客户端）；须由协调者/浏览器侧在 Preview 与生产各补验一次（表格渲染行数 >0、控制台零 CSP 违规、零脚本错误），不得以本脚本结果替代。");
  }

  if (want("S4")) {
    console.log("S4 API 头组（/api/board，§18.3）：");
    const expectApiHeaders = (headers, label) => {
      ok(headers.get("x-content-type-options") === "nosniff", `${label} nosniff`, `实际 ${JSON.stringify(headers.get("x-content-type-options"))}`);
      ok(headers.get("referrer-policy") === "no-referrer", `${label} Referrer-Policy no-referrer`, `实际 ${JSON.stringify(headers.get("referrer-policy"))}`);
      ok(headers.get("content-security-policy") === "default-src 'none'", `${label} CSP default-src 'none'`, `实际 ${JSON.stringify(headers.get("content-security-policy"))}`);
    };
    const get = await fetch(base + "/api/board");
    ok(get.status === 200, "GET /api/board 状态 200", `实际 ${get.status}`);
    expectApiHeaders(get.headers, "GET 200");
    await get.text().catch(() => "");
    const post = await fetch(base + "/api/board", { method: "POST" });
    ok(post.status === 405, "POST /api/board 状态 405", `实际 ${post.status}`);
    expectApiHeaders(post.headers, "POST 405");
    await post.text().catch(() => "");
  }

  if (want("S5")) {
    console.log("S5 Web Analytics beacon 证据（§18.4-2）：");
    if (variant === "on") {
      const html = homeBuf.toString("utf8");
      ok(html.includes("static.cloudflareinsights.com"), "WA-ON：线上 HTML 含 beacon 注入痕迹");
      skip("WA-ON：/cdn-cgi/rum POST 返回 204", "需浏览器 Network 面板证据，须由协调者/浏览器侧补验并截图入留痕。");
    } else {
      const html = homeBuf.toString("utf8");
      ok(!html.includes("cloudflareinsights"), "WA-OFF：线上 HTML 无 cloudflareinsights 请求痕迹");
    }
  }

  console.log(failures === 0 ? "[smoke-headers] 全部断言通过（SKIP 项除外，见上注）。" : `[smoke-headers] ${failures} 项 FAIL。`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`[smoke-headers] 运行失败：${e.message}`);
  process.exit(1);
});
