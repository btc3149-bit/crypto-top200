// tests/helpers/kv-guard-scan.mjs — F7-03 KV 写守卫扫描器（token 级，非正则字面匹配）
// 背景：旧守卫只正则匹配字面 `BOARD_KV.(put|delete)(`，别名/解构/计算属性写法可绕过
// （PHASE7_REVIEW F7-03，两路实测坐实）。本扫描器先把源码 token 化（剥离注释、
// 字符串与正则字面量内容），再做两件事：
//   1) 来源追踪（provenance）：迭代识别由 env / context.env / BOARD_KV 派生的标识符
//      ——直接别名、链式别名、解构（含重命名）、成员别名（const p = kv.put）、
//      计算属性（kv["put"]、kv["pu"+"t"]）均纳入。
//   2) 写能力判定：任何对 KV 接收者的 put/delete 调用、方法别名抽取/转手
//      （.put.call/.bind、赋值给变量）、以及接收者来源不可判定（未声明标识符、
//      函数形参等）的 put/delete 调用，一律记为 offender（fail-closed）。
//      接收者被证明为非 KV（如由 caches.default 派生的 cache 变量、字面对象）
//      的 put/delete 不拦（board.js 现行 cache.put 即此形态）。
// 唯一批准写：functions/api/board.js 中 addLegacyCredits 函数体内、接收者恰为
// env.BOARD_KV、方法恰为 put、第一实参恰为 KV_KEYS.legacyCredits 的 1 处调用。
// 其余一律失败——包括对 legacyCredits 键的 delete、错文件、错函数体内的同形调用。
//
// 已知边界（如实登记）：经函数返回值间接取得 KV（如 const kv = getKv() 的返回值
// 若实为 KV）无法静态判定来源——此类调用接收者为「不可判定」会被 fail-closed
// 拦下（须过评审在本扫描器登记来源后才放行）；Reflect.set / Proxy set 陷阱等
// 元编程写路径不在本扫描器口径内，靠代码评审兜底（落点：
// ops/security/security-baseline.md §5.2 已单列 Reflect/Proxy 人工检查项，F8-36）。
// F8-37：eval( / Function( 构造在本扫描范围内一律记 offender（禁止构造），
// 使「字符串内写调用」通道无法被静默引入；字符串内容本身仍不可见，靠此禁令
// + baseline 登记的运行时禁止 eval 口径双层兜底。
// F8-03/F8-33/F8-34（第八期加固）：可选链（?. 与 ?.()）、多层嵌套解构与
// for-of/for-in 解构、标识符与字符串中的 Unicode 转义（pu\u0074）均纳入判定。

const WRITE_METHODS = new Set(["put", "delete"]);

// ---------------- tokenizer ----------------
// token: { t: "id"|"num"|"str"|"punct", v, pos }；模板字符串字面部分记为 str，
// ${} 内表达式照常 token 化；正则字面量整体跳过（内容不参与判定）。
export function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const push = (t, v, pos) => toks.push({ t, v, pos });
  // 读 src[pos]=='\\' 处的转义序列，返回 {ch, next}（F8-34：\uXXXX 须解码后再判定）
  function readEscape(pos) {
    const c = src[pos + 1];
    if (c === "u") {
      if (src[pos + 2] === "{") {
        const end = src.indexOf("}", pos + 3);
        if (end > pos) { const cp = parseInt(src.slice(pos + 3, end), 16); if (Number.isFinite(cp)) return { ch: String.fromCodePoint(cp), next: end + 1 }; }
        return { ch: "u", next: pos + 2 };
      }
      const hex = src.slice(pos + 2, pos + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) return { ch: String.fromCharCode(parseInt(hex, 16)), next: pos + 6 };
      return { ch: "u", next: pos + 2 };
    }
    if (c === "x") { const hex = src.slice(pos + 2, pos + 4); if (/^[0-9a-fA-F]{2}$/.test(hex)) return { ch: String.fromCharCode(parseInt(hex, 16)), next: pos + 4 }; return { ch: "x", next: pos + 2 }; }
    const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
    return { ch: map[c] ?? (c ?? ""), next: pos + 2 };
  }
  function prevSignificant() {
    return toks.length ? toks[toks.length - 1] : null;
  }
  function regexAllowed() {
    const p = prevSignificant();
    if (!p) return true;
    if (p.t === "id" || p.t === "num" || p.t === "str") return false;
    if (p.t === "punct" && [")", "]", "}"].includes(p.v)) return false;
    return true;
  }
  function scanString(q) {
    const start = i;
    i++; // 开引号
    let out = "";
    while (i < n && src[i] !== q) {
      if (src[i] === "\\") { const e = readEscape(i); out += e.ch; i = e.next; }
      else { out += src[i]; i++; }
    }
    i++; // 闭引号
    push("str", out, start);
  }
  function scanTemplate() {
    // 模板：字面段记 str token；${...} 段递归扫描内部 token（以 ${ } 包裹）
    let start = i;
    i++; // 反引号
    let lit = "";
    const flush = () => { if (lit) { push("str", lit, start); lit = ""; } };
    while (i < n) {
      const c = src[i];
      if (c === "\\") { const e = readEscape(i); lit += e.ch; i = e.next; continue; }
      if (c === "`") { i++; break; }
      if (c === "$" && src[i + 1] === "{") {
        flush();
        push("punct", "${", i);
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const before = i;
          scanOne();
          const tk = toks[toks.length - 1];
          if (tk && tk.pos >= before) {
            if (tk.t === "punct" && tk.v === "{") depth++;
            else if (tk.t === "punct" && tk.v === "}") depth--;
          }
        }
        start = i;
        continue;
      }
      lit += c; i++;
    }
    flush();
  }
  function scanOne() {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; return; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; return; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; return; }
    if (c === "'" || c === '"') { scanString(c); return; }
    if (c === "`") { scanTemplate(); return; }
    if (c === "/" && regexAllowed()) {
      const start = i; i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { i++; break; }
        else if (src[i] === "\n") break;
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++; // flags
      push("str", "", start); // 正则内容不参与判定，占位为不可判定字符串
      return;
    }
    if (/[A-Za-z_$]/.test(c) || (c === "\\" && src[i + 1] === "u")) {
      const start = i;
      let val = "";
      while (i < n) {
        if (/[A-Za-z0-9_$]/.test(src[i])) { val += src[i]; i++; }
        else if (src[i] === "\\" && src[i + 1] === "u") { const e = readEscape(i); if (!/[A-Za-z0-9_$]/.test(e.ch)) break; val += e.ch; i = e.next; }
        else break;
      }
      push("id", val, start);
      return;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9a-fA-Fxob._eE+-]/.test(src[i])) i++;
      push("num", src.slice(start, i), start);
      return;
    }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (["===", "!==", "**=", "<<=", ">>=", ">>>", "..."].includes(three)) { push("punct", three, i); i += 3; return; }
    if (["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "**", "<<", ">>"].includes(two)) { push("punct", two, i); i += 2; return; }
    push("punct", c, i); i++;
  }
  while (i < n) scanOne();
  return toks;
}

// ---------------- 工具 ----------------
function lineOf(src, pos) {
  let line = 1;
  for (let k = 0; k < pos && k < src.length; k++) if (src[k] === "\n") line++;
  return line;
}
// 在 toks 中找与 openIdx 处括号配平的闭括号下标
function matchBracket(toks, openIdx) {
  const open = toks[openIdx].v;
  const close = { "(": ")", "[": "]", "{": "}", "${": "}" }[open];
  let depth = 0;
  for (let j = openIdx; j < toks.length; j++) {
    const v = toks[j].v;
    if (v === open || (open === "(" && v === "${")) depth++;
    else if (v === close) { depth--; if (depth === 0) return j; }
    else if (open === "(" && (v === "(" || v === "[" || v === "{")) depth++;
    else if (open === "(" && (v === ")" || v === "]" || v === "}")) depth--;
  }
  return -1;
}
// 表达式 token 切片在顶层逗号/分号/右括号处截断，返回 [start, end)
function exprSlice(toks, start) {
  let depth = 0;
  let j = start;
  for (; j < toks.length; j++) {
    const v = toks[j].v;
    if (["(", "[", "{", "${"].includes(v)) depth++;
    else if ([")", "]", "}"].includes(v)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && (v === "," || v === ";")) break;
  }
  return [start, j];
}

// ---------------- 主扫描 ----------------
export function scanKvWrites(src, relPath) {
  const toks = tokenize(src);
  const isBoard = /(^|\/)functions\/api\/board\.js$/.test(relPath.replace(/\\/g, "/"));

  // addLegacyCredits 函数体范围（token 下标区间），供「位置精确核准」
  let legacyFnRange = null;
  for (let j = 0; j + 2 < toks.length; j++) {
    if (toks[j].t === "id" && toks[j].v === "function" && toks[j + 1].v === "addLegacyCredits") {
      let k = j + 2;
      while (k < toks.length && toks[k].v !== "{") k++;
      const end = matchBracket(toks, k);
      if (end > k) legacyFnRange = [k, end];
      break;
    }
  }

  // ---- 来源追踪 ----
  const kvVars = new Set();       // 标识符 → KV 绑定本身
  const envVars = new Set(["env"]); // 标识符 → env 对象（context 经 .env 成员归约）
  const nonKvVars = new Set();    // 标识符 → 已证明非 KV（如 caches.default 派生）
  const methodAliases = new Map(); // 标识符 → "put"|"delete"（由 KV 抽取的方法别名）

  // 判定表达式切片的来源类别
  function classify(s, e) {
    if (s >= e) return "unknown";
    // 括号包裹
    if (toks[s].v === "(" && matchBracket(toks, s) === e - 1) return classify(s + 1, e - 1);
    // 单标识符
    if (e - s === 1 && toks[s].t === "id") {
      if (kvVars.has(toks[s].v)) return "kv";
      if (envVars.has(toks[s].v)) return "env";
      if (nonKvVars.has(toks[s].v)) return "nonkv";
      return "unknown";
    }
    // 以 .BOARD_KV / ["BOARD_KV"] 结尾 → KV（BOARD_KV 为绑定名，全仓唯一语义）
    const last = toks[e - 1];
    if (last.t === "id" && last.v === "BOARD_KV" && toks[e - 2] && [".", "?."].includes(toks[e - 2].v)) return "kv";
    if (last.v === "]" && toks[e - 2] && toks[e - 2].t === "str" && toks[e - 2].v === "BOARD_KV") return "kv";
    // BOARD_KV 成员后接写方法作值（env.BOARD_KV.put / kv.put）→ kv-method:<name>
    for (let j = s; j < e; j++) {
      if (toks[j].t === "id" && toks[j].v === "BOARD_KV") {
        if (j + 2 === e - 1 && [".", "?."].includes(toks[j + 1].v) && WRITE_METHODS.has(toks[e - 1].v)) return `kv-method:${toks[e - 1].v}`;
        return "kv";
      }
    }
    // 以 .env 结尾 → env 对象（context.env 等）
    if (last.t === "id" && last.v === "env" && toks[e - 2] && [".", "?."].includes(toks[e - 2].v)) return "env";
    // 含 caches 全局（caches.default 等）→ 非 KV
    for (let j = s; j < e; j++) if (toks[j].t === "id" && toks[j].v === "caches") return "nonkv";
    // KV 变量的成员（如 kv.put 作为值）→ kv-method:<name>
    if (toks[s].t === "id" && kvVars.has(toks[s].v)) {
      const m = last.t === "id" ? last.v : null;
      return m ? `kv-method:${m}` : "kv";
    }
    // env 派生成员链（如 env.SOMETHING 非 BOARD_KV）→ 非 KV 绑定
    if (toks[s].t === "id" && envVars.has(toks[s].v)) return "nonkv";
    // 字面量 / new / 函数调用等构造 → 非 KV（其返回值若实为 KV 属登记边界，见文件头）
    if (toks[s].t === "str" || toks[s].t === "num" || toks[s].v === "{" || toks[s].v === "[" || toks[s].v === "new" || toks[s].v === "typeof") return "nonkv";
    return "unknown";
  }

  function bindDeclarators() {
    let changed = false;
    const bind = (name, cls, methodName) => {
      if (cls === "kv" && !kvVars.has(name)) { kvVars.add(name); changed = true; }
      else if (cls === "env" && !envVars.has(name)) { envVars.add(name); changed = true; }
      else if (cls === "nonkv" && !nonKvVars.has(name)) { nonKvVars.add(name); changed = true; }
      else if (cls && cls.startsWith("kv-method:") && WRITE_METHODS.has(cls.slice(10))) {
        if (!methodAliases.has(name)) { methodAliases.set(name, cls.slice(10)); changed = true; }
      }
    };
    for (let j = 0; j < toks.length; j++) {
      const tk = toks[j];
      // 解构（F8-33 加固）：递归解析模式——多层嵌套 {BOARD_KV:{put}}、
      // for-of/for-in 解构 for(const {put} of [kv])、以及形参解构（来源不可
      // 判定 → fail-closed 把写方法名登记为别名）均纳入。
      if (tk.v === "{") {
        const close = matchBracket(toks, j);
        if (close > j) {
          const after = toks[close + 1] && toks[close + 1].v;
          const isDeclCtx = j === 0 || [";", "{", "}", "(", ","].includes(toks[j - 1].v) || ["const", "let", "var"].includes(toks[j - 1].v);
          let srcCls = null;
          if (after === "=" && toks[close + 2] && toks[close + 2].v !== "=") {
            const [es, ee] = exprSlice(toks, close + 2);
            srcCls = classify(es, ee);
          } else if ((after === "of" || after === "in") && isDeclCtx) {
            // 迭代来源：取 for 头括号内 of/in 之后的表达式；含 KV 元素即 kv
            const [es, ee] = exprSlice(toks, close + 2);
            srcCls = classify(es, ee);
            if (srcCls !== "kv") {
              for (let k = es; k < ee; k++) {
                if (toks[k].t === "id" && (toks[k].v === "BOARD_KV" || kvVars.has(toks[k].v))) { srcCls = "kv"; break; }
              }
              if (srcCls === "nonkv" ) srcCls = "unknown"; // 数组字面量含 KV 元素时上行已置 kv；纯字面量解构写方法极罕见，按 fail-closed 之外的 nonkv 处理需谨慎——此处字面量元素非 KV 时 classify 的 "[" 分支给 nonkv，已在上行保留
              if (srcCls === "unknown") { /* 保持 unknown：fail-closed */ }
            }
          } else if (isDeclCtx && (after === ")" || after === "," || after === "=")) {
            srcCls = "unknown"; // 形参解构：来源不可判定
          }
          if (srcCls !== null && srcCls !== undefined) {
            // 递归绑定：cls 为当前层对象的来源类别
            const bindPattern = (openIdx, closeIdx, cls) => {
              let k = openIdx + 1;
              while (k < closeIdx) {
                const keyTok = toks[k];
                if (keyTok.t !== "id" && keyTok.t !== "str") { k++; continue; }
                const key = keyTok.v;
                // 跳过默认值表达式中的标识符：仅处理顶层条目（逗号分隔）
                let local = null, subOpen = -1, subClose = -1, advance = k + 1;
                if (toks[k + 1] && toks[k + 1].v === ":" ) {
                  if (toks[k + 2] && toks[k + 2].t === "id") { local = toks[k + 2].v; advance = k + 3; }
                  else if (toks[k + 2] && toks[k + 2].v === "{") { subOpen = k + 2; subClose = matchBracket(toks, subOpen); advance = subClose + 1; }
                  else if (toks[k + 2] && toks[k + 2].v === "[") { subOpen = k + 2; subClose = matchBracket(toks, subOpen); advance = subClose + 1; }
                } else if (keyTok.t === "id") { local = key; }
                // 子来源类别
                let subCls = "unknown";
                if (cls === "env") subCls = key === "BOARD_KV" ? "kv" : "nonkv";
                else if (cls === "kv") subCls = "kv";
                else if (cls === "nonkv") subCls = "nonkv";
                if (subOpen >= 0 && subClose > subOpen) {
                  if (toks[subOpen].v === "{") bindPattern(subOpen, subClose, subCls);
                  // 数组模式解构不产生写方法别名（元素为标识符时按 subCls 绑定）
                  else for (let q = subOpen + 1; q < subClose; q++) if (toks[q].t === "id") bind(toks[q].v, subCls === "kv" ? "unknown" : subCls);
                } else if (local) {
                  if ((cls === "kv" || cls === "unknown") && WRITE_METHODS.has(key)) {
                    if (cls === "kv" || cls === "unknown") { if (!methodAliases.has(local)) { methodAliases.set(local, key); changed = true; } }
                  } else if (cls === "env" && key === "BOARD_KV") bind(local, "kv");
                  else if (cls === "kv") bind(local, "unknown");
                  else if (cls === "env") bind(local, "nonkv");
                }
                // 前进到下一顶层逗号
                let depth = 0; k = Math.max(advance, k + 1);
                while (k < closeIdx) {
                  const v = toks[k].v;
                  if (["{", "[", "("].includes(v)) depth++;
                  else if (["}", "]", ")"].includes(v)) depth--;
                  else if (v === "," && depth === 0) { k++; break; }
                  k++;
                }
              }
            };
            // nonkv 来源的解构写方法不登记（已证明非 KV，如字面对象）
            if (srcCls !== "nonkv") bindPattern(j, close, srcCls);
            else {
              // 仍须绑定 BOARD_KV 等结构以免后续误判：仅 env 派生处理，nonkv 跳过
            }
            if (after === "=" || after === "of" || after === "in") continue;
          }
        }
      }
      // 普通声明/赋值：<id> = <expr>（排除 == / => / 成员赋值 a.b =）
      if (tk.t === "id" && toks[j + 1] && toks[j + 1].v === "=" && !(toks[j - 1] && toks[j - 1].v === ".")) {
        const [es, ee] = exprSlice(toks, j + 2);
        if (es < ee) bind(tk.v, classify(es, ee));
      }
    }
    return changed;
  }
  for (let pass = 0; pass < 6 && bindDeclarators(); pass++) { /* 迭代至不动点：链式别名逐层传播 */ }

  // ---- 写能力判定 ----
  const offenders = [];
  let allowed = 0;
  const offend = (idx, what) => offenders.push(`${relPath}:${lineOf(src, toks[idx].pos)} ${what}`);

  // 接收者起点：从成员访问的点/括号前一 token 向左回溯整条成员链
  function receiverStart(dotIdx) {
    let j = dotIdx - 1;
    while (j >= 0) {
      const t = toks[j];
      if (t.v === "]" || t.v === ")") {
        const open = t.v === "]" ? "[" : "(";
        let depth = 0, k = j;
        for (; k >= 0; k--) {
          if (toks[k].v === t.v) depth++;
          else if (toks[k].v === open) { depth--; if (depth === 0) break; }
        }
        j = k - 1;
        if (j >= 0 && toks[j].t === "id") { j--; continue; }
        break;
      }
      if (t.t === "id" || t.t === "str" || t.t === "num") {
        j--;
        if (j >= 0 && (toks[j].v === "." || toks[j].v === "?.")) { j--; continue; }
        break;
      }
      break;
    }
    return j + 1;
  }
  // 计算属性键求值：str ( + str )* → 拼接值；含标识符等不可静态求值 → null
  function computedKeyValue(openIdx) {
    const close = matchBracket(toks, openIdx);
    if (close < 0) return { value: null, close };
    let val = "";
    let expectStr = true;
    for (let k = openIdx + 1; k < close; k++) {
      if (expectStr) {
        if (toks[k].t !== "str") return { value: null, close };
        val += toks[k].v; expectStr = false;
      } else {
        if (toks[k].v !== "+") return { value: null, close };
        expectStr = true;
      }
    }
    return { value: expectStr ? null : val, close };
  }
  // 第一实参 token 切片
  function firstArg(callOpenIdx) {
    const [s, e] = exprSlice(toks, callOpenIdx + 1);
    return [s, e];
  }
  const tokensEqual = (s, e, want) => e - s === want.length && want.every((w, k) => toks[s + k].v === w);

  for (let j = 0; j < toks.length; j++) {
    const tk = toks[j];
    // (A) 成员访问： .put / .delete 或 ["put"] / ["pu"+"t"] 等计算属性
    let method = null, methodEnd = -1, accessIdx = -1;
    if ((tk.v === "." || tk.v === "?.") && toks[j + 1] && toks[j + 1].t === "id" && WRITE_METHODS.has(toks[j + 1].v)) {
      method = toks[j + 1].v; methodEnd = j + 1; accessIdx = j;
    } else if (tk.v === "[") {
      const { value, close } = computedKeyValue(j);
      const rs = receiverStart(j);
      const recvCls = classify(rs, j);
      if (value && WRITE_METHODS.has(value)) { method = value; methodEnd = close; accessIdx = j; }
      else if (recvCls === "kv" && value === null) {
        offend(j, "KV 接收者上的不可静态求值计算属性访问（方法名不可判定，fail-closed）");
        continue;
      } else {
        continue;
      }
      // 计算属性路径：接收者在 [ 之前
      const start = rs;
      const cls = recvCls;
      const after = toks[methodEnd + 1];
      if (cls === "kv" || cls === "unknown") {
        offend(accessIdx, `KV 写调用（计算属性 ${method}，来源=${cls}）——除 board.js addLegacyCredits 的批准 put 外一律禁止`);
      }
      continue;
    }
    if (method) {
      const start = receiverStart(accessIdx);
      const cls = classify(start, accessIdx);
      const after = toks[methodEnd + 1];
      const isCall = after && (after.v === "(" || (after.v === "?." && toks[methodEnd + 2] && toks[methodEnd + 2].v === "("));
      if (cls === "nonkv") continue; // 已证明非 KV（如 cache.put）
      if (isCall) {
        // 批准判定：文件、接收者、方法、键、函数体位置五项全合
        const callOpen = after.v === "(" ? methodEnd + 1 : methodEnd + 2;
        const [as, ae] = firstArg(callOpen);
        const approved =
          isBoard && method === "put" &&
          tokensEqual(start, accessIdx, ["env", ".", "BOARD_KV"]) &&
          tokensEqual(as, ae, ["KV_KEYS", ".", "legacyCredits"]) &&
          legacyFnRange && j > legacyFnRange[0] && j < legacyFnRange[1];
        if (approved) { allowed += 1; continue; }
        offend(accessIdx, `未批准的 KV 写调用 .${method}(（接收者来源=${cls}）`);
        continue;
      }
      // 非调用成员访问：别名抽取（赋值 RHS）或转手（.call/.bind/.apply 链）→ 写能力外逃
      const next = after;
      const prev = toks[accessIdx - 1];
      if ((prev && prev.v === "=") || (next && (next.v === "." || next.v === "?."))) {
        if (cls === "kv" || cls === "unknown") offend(accessIdx, `KV 写方法 .${method} 被抽取/转手（别名或 .call/.bind 形态，来源=${cls}）`);
      }
      // typeof env.BOARD_KV.put !== "function" 一类能力探测：非调用、非抽取，放行
      continue;
    }
    // (B) 裸标识符调用：由 KV 解构/别名得到的方法（直调与可选链调用）
    if (tk.t === "id" && methodAliases.has(tk.v) && toks[j + 1] &&
        (toks[j + 1].v === "(" || (toks[j + 1].v === "?." && toks[j + 2] && toks[j + 2].v === "(")) &&
        !(toks[j - 1] && (toks[j - 1].v === "." || toks[j - 1].v === "?."))) {
      offend(j, `经别名/解构取得的 KV 写方法 ${tk.v}(...) 被调用`);
    }
    // (C) F8-37 禁止构造：eval( / Function( 在扫描范围内一律 offender
    if (tk.t === "id" && (tk.v === "eval" || tk.v === "Function") && toks[j + 1] && toks[j + 1].v === "(" &&
        !(toks[j - 1] && toks[j - 1].v === "function")) {
      offend(j, `禁止构造 ${tk.v}(（F8-37：动态代码构造在守卫范围内一律禁止）`);
    }
  }
  return { allowed, offenders, kvVars: [...kvVars], methodAliases: Object.fromEntries(methodAliases) };
}
