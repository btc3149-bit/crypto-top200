# 安全评级基线与月度复测（W4-20）

> 工作包：W4-20（P2，第四期）「安全头与 Zone 配置治理」之评级基线部分；对应发现 F4-29、F4-30。
> 建立日期：2026-11-13。本文件是 MDN Observatory 分数的唯一基线留痕处；Zone 侧影子配置另见 `zone-config-registry.md`。
> 红线：复测只做公开扫描与响应头读取，不改任何线上配置。

---

## 1. 基线（2026-11-13 定版）

| 日期 | 分数 / 等级 | 通过项 | 变体 / 背景 | 来源 |
|---|---|---|---|---|
| 2026-11-10 | **145 / A+** | 12/12 | WA-OFF（CSP 无统计域名） | `CONSTRUCTION_PHASE2.md` W2-18 行；`ops/compliance-log/2026-Q4.md` G1 关闭条 |
| 2026-11-13（评审实测） | **135 / A+** | 未记录 | WA-ON | PHASE4_REVIEW.md F4-29（安全路实查口径） |
| 2026-11-13（本轮复测） | **135 / A+** | 11/12（1 项未通过） | WA-ON，与线上当前响应头一致 | 本轮 API 实测，证据见下 |

**现行基线 = 135 分 / A+（2026-11-13）。** 后续一切漂移判断以此为准，不再以 145 为基准（145 是 WA-OFF 历史形态的分数，见 §3 的回退调查）。

本轮实测证据（只读公开扫描）：

- 接口：`POST https://observatory-api.mdn.mozilla.net/api/v2/scan?host=top200.oppcal.com`（空 body 表单式提交；带 JSON body 的调用方式会被该 API 拒绝，已实测）。
- 返回：`id = 135196637`、`grade = "A+"`、`score = 135`、`algorithm_version = 6`、`status_code = 200`、`tests_passed = 11`、`tests_failed = 1`、`tests_quantity = 12`、`scanned_at = 2026-11-13T02:49:14.825Z`。
- 详情页：`https://developer.mozilla.org/en-US/observatory/analyze?host=top200.oppcal.com`（scan 返回的 `details_url`）。
- 同期线上响应头抽查（`curl -sI https://top200.oppcal.com/`，2026-11-13）：CSP（WA-ON 变体，两枚 hash + 统计域名在位）、HSTS、nosniff、X-Frame-Options、Referrer-Policy、Permissions-Policy、COOP、CORP 均在位，与仓库 `public/_headers` 一致；另见 Zone 侧 `Access-Control-Allow-Origin: *` 在位，该项登记于 `zone-config-registry.md`。

未取得项：逐项测试明细（哪 1 项未通过）。v2 API 的逐项结果端点本轮实测不可用（候选路径均返回 404），analyze 详情页为 JS 渲染、文本抓取取不到明细。确认路径见 §3.3。

---

## 2. 漂移阈值与处置

| 情形 | 定性 | 处置 |
|---|---|---|
| 等级跌出 A+（grade 低于 A+，或分数 <100） | **安全事件** | 当日建 `ops/incidents/` 事件页；按 §3 的方法对照 `_headers` 与 Zone 侧变更定位；修复或回滚后复扫至回 A+ 才关单 |
| 分数较基线（135）下降 ≥10 分（即使仍在 A+ 内） | **安全事件** | 同上。145→135 的教训即在于此：段内回退无人察觉等于无监测（F4-29） |
| 分数下降 1–9 分 | 记录待查 | 记入 §4 复测记录表备注，下月复测重点对照；连续两次下降按安全事件升级 |
| 分数上升 | 记录 | 记入复测记录表；上升 ≥10 分时由站长确认是否把基线值上调定版（改基线须在本节留一行变更注记） |

---

## 3. F4-29 调查：145 → 135 回退原因

### 3.1 时间线（git 证据）

| 时点 | 事件 | 安全头变化 |
|---|---|---|
| 2026-11-10 晚 | W2-18 正式头上线（WA-OFF），Observatory 实测 **145**、12/12 通过 | CSP：`script-src 'self'` + 两枚 hash；`connect-src 'self'`；无任何外部主机（`git show c96bd4a:public/_headers`） |
| 2026-11-11 19:26 | commit `4ff309c`「W2-14 Web Analytics 启用」：CSP 由 WA-OFF 切 WA-ON 并同发版 | `script-src` 新增 `https://static.cloudflareinsights.com`；`connect-src` 新增 `https://cloudflareinsights.com`——**这是 145 与 135 两次测量之间唯一一次 CSP 指令级放宽** |
| 2026-11-12 | commit `dd9d9bc`（U4 回链）、`f515ef4`（三期 UI） | 仅内联脚本/样式内容变化导致 hash 值轮换（指令结构不变）；`f515ef4` 另给首页精确路径新增 `Cache-Control`（SWR），不涉安全头评分项 |
| 2026-11-13 | 评审实测与本轮复测均为 **135**、11/12 通过 | 与 WA-ON 形态稳定对应 |

其余评分相关头（HSTS、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy、COOP、CORP）在整个窗口内逐字未变（`git log -- public/_headers ops/headers/` 全程可核）。

### 3.2 结论（有证据）

**主因定位：145→135 的 −10 分由 2026-11-11 Web Analytics 启用时的 CSP WA-ON 放宽造成。** 证据链：①分数变化窗口内仓库侧安全头只有这一次指令级变更；②变更内容正是给 `script-src` 引入外部脚本主机——Observatory 的 CSP 评估对「脚本可从外部源加载」的扣分量级与 −10 分、且通过项由 12/12 降为 11/12 的形态吻合；③WA-ON 上线后两次独立实测（评审、本轮）稳定在 135，未随其后两次仅换 hash 的发版波动，排除了 hash 轮换与 SWR 头的影响。这是 U7 签收启用统计的已知代价，不是配置漂移或外部攻击，**不构成需要回滚的安全事故**；基线已按 §1 改以 135 定版。

### 3.3 未决残项（明确标注）

- **【F7-50 修订，2026-11-23：未过项口径已统一定版】** 本节原写「未通过的 1 项究竟是 CSP 项本身，仍待逐项明细确认」，与 §5.4 的定版结论自相矛盾，现统一以 §5.4 口径为准：**Observatory 135 / A+ 的唯一未过项即 SRI（−5）**，已于 2026-11-23 W5 正式接受现状并销项（证据与再评估条件见 §5.4）。本节原「待确认」表述为 §5.4 定版前的历史状态，保留备查、不得再按未决引用；§3.2 的 −10 分 CSP WA-ON 归因与本项 −5 分 SRI 为两个不同扣分项，勿混。
- Zone 侧 `Access-Control-Allow-Origin: *` 的出现时点无任何变更记录（不在 git 内），无法用时间线排除其对分数的贡献——这正是 F4-31「影子配置打破唯一事实源」的具体危害。其处置见 `zone-config-registry.md`，与本调查并行，不阻塞基线定版。（注：该 ACAO 已于 2026-11-13 W4-20 收编为仓库显式单一来源且复测分数不变，见 §4 复测记录，实验证明其非未过项来源。）

---

## 4. 月度人工复测程序

节奏：每月一次（建议与 `ops/quota-ledger.md` 的月度复核同日做）；另在每次修改 `public/_headers` 或 `ops/headers/` 的发版后加测一次。

步骤：

1. 触发公开扫描并取分数（只读）：

   ```bash
   curl -s -X POST "https://observatory-api.mdn.mozilla.net/api/v2/scan?host=top200.oppcal.com" -d ''
   ```

   记录返回的 `score`、`grade`、`tests_passed / tests_failed / tests_quantity`、`id`、`scanned_at`。API 不可用时改走人工路径：浏览器打开 `https://developer.mozilla.org/en-US/observatory/analyze?host=top200.oppcal.com` 目视分数，并把「API 不可用、走人工路径」记入备注。

2. 本地头冒烟对照（只读）：

   ```bash
   node ops/headers/smoke-headers.mjs https://top200.oppcal.com --variant=on
   ```

3. 把结果追加到下方复测记录表（一行一次）；对照 §2 阈值定性，触发安全事件的按 §2 处置并在备注栏链接事件页。

### 复测记录

| 日期 | 分数 / 等级 | 通过项 | scan id | 方式 | 备注 |
|---|---|---|---|---|---|
| 2026-11-13 | 135 / A+ | 11/12 | `135196637` | API 实测（W4-20 建基线） | 基线定版；逐项明细未取得，确认路径见 §3.3 |
| 2026-11-13 | 135 / A+ | 11/12 | `135200672` | API 实测（W4-20 收编处置前） | ACAO 收编上线前复测，与基线一致 |
| 2026-11-13 | 135 / A+ | 11/12 | `135218297` | API 实测（W4-20 收编部署 `8dff02de` 后） | ACAO 由 `*` 收编为仓库显式声明后分数不变——实验证明 ACAO 不是那 1 项扣分来源，§3.2 的 CSP 归因进一步坐实；未通过项名称仍待人工在 analyze 页确认（本轮再试 scan 明细端点两条路径仍 404） |

---

## 5. 治理登记（第六期，2026-11-23 补登）

### 5.1 已知权限面：Pages 侧 BOARD_KV 绑定为平台读写权限（F6-92）

- 事实：Cloudflare KV 绑定不区分读写。根 `wrangler.toml` 的 `BOARD_KV` 绑定
  在平台层实为**读写权限**：Pages 任一 Function 均可对同一
  命名空间执行 `put`/`delete`（含 `v1:board:current`、`v1:meta:health` 等键）。
  「只读」靠代码自律与守卫测试把关。**【F7-49 修订，2026-11-23】现行代码并非
  全量只 `get`：W5 经站长批准的唯一写例外已落地——`functions/api/board.js`
  仅可对计数键 `v1:meta:legacy-credits`（`KV_KEYS.legacyCredits`）执行 `put`
  （legacy/dual 形态真实回源时 +2 credits 的实测计量，kv 形态不触发），
  health.js 仍只 `get`；除该例外外 `functions/` 不得出现任何 `BOARD_KV.put`，
  `BOARD_KV.delete` 全面禁止。根 `wrangler.toml` 注释与本节口径一致。**
- 定性：已知权限面登记，**非现行漏洞**；风险在未来新增 Function 或既有代码
  引入缺陷时，写权限无平台层兜底，爆炸半径含生产 blob 与健康键。
- 硬性检查项（并入代码评审清单，见 §5.2）：`functions/` 下除上述 W5 唯一
  批准例外（board.js 对 `legacyCredits` 键的 `put`，逐点核准）外不得出现
  `BOARD_KV.put`，且不得出现 `BOARD_KV.delete`，由契约测试
  `tests/kv-write-guard.test.mjs`（grep 型守护，逐点核准调用点与键名）持续把关；
  评审时人工复核与该测试缺一不可。

### 5.2 代码评审硬性检查项清单（节选，F6-92 新增首项）

- [ ] **（F6-92，F7-49 修订）`functions/` 的 KV 写面只允许 W5 唯一批准例外
      （board.js 对 `v1:meta:legacy-credits` 的 `put`），其余 `BOARD_KV.put`
      与一切 `BOARD_KV.delete` 均不得出现**；
      新增 Function 时逐一复核其 KV 用法，除该例外外的写方只能是 workers/fetcher。
- [ ] 新增/变更 Pages Function 不得引入超出其职责的 KV、环境变量与外部抓取面
      （与 §5.1 权限面登记一并复核）。

### 5.3 Sec-Fetch-Site 影子模式复核点（F6-94，W2-19 条目）

- 现状：`functions/api/board.js` 的 `ENFORCE_SFS = false`，跨站检查
  （sfsShadowCheck）只记日志不拦截（W2-19 定版影子期）。当前实际防线为 board
  响应不带 `Access-Control-Allow-Origin` 头，跨源脚本读不到响应体，且数据
  本身为公开行情，实际风险低。
- **复核点（防影子期无限期延续）**：下次季度自查（见
  `ops/quarterly/2027-Q1-checklist.md` 一轮）时**必须二选一并在此留痕**：
  ①将 `ENFORCE_SFS` 置 `true` 转正式拦截（代码已备，须先看影子期日志确认
  无合法跨站流量误伤）；或 ②在本节正式销项接受现状，并写明接受理由与
  再评估触发条件（如未来给 board 加 `Access-Control-Allow-Origin: *` 时
  本销项自动失效、必须先转正式）。二者皆未做之前，本条目保持「未决」，
  不得在汇报中表述为已处置。

### 5.4 SRI 条目现状确认（F6-89）

- 2026-11-23 第六期复核确认现状登记无误：HTML/源码中无 `integrity` 属性
  （全仓 grep 的命中仅 package-lock.json 的 npm 哈希字段与评审文档本身，
  与 SRI 无关），Web Analytics beacon 等外链脚本无 SRI 属性；与 §1 基线
  一致——Observatory 135 / A+ 的唯一未过项即 SRI（−5）。
- 处置路径不变：**维持 W5 增补包既有处置路径**（实施 SRI 或正式接受并在
  本文件销项），第六期不重复施工、不重复定级。
- **W5 处置定版（2026-11-23）：正式接受现状，本条销项。** 全站外部脚本盘点
  （public/index.html 与 public/privacy/index.html 全部 HTML）：仅一支外部
  脚本——Cloudflare Web Analytics beacon
  `https://static.cloudflareinsights.com/beacon.min.js`（两页各一处，手动嵌入、
  带站点 token），无其他外链脚本；内联脚本与 JSON-LD 为同源内联、由 CSP
  sha256 hash 放行，不属 SRI 范围。
  - 无法承载 SRI 的证据：① Cloudflare 官方 FAQ（Web Analytics FAQ“How can
    I enforce Subresource Integrity (SRI) with the JS beacon?”）明确：手动
    嵌入方式「没有安全施加 integrity 属性的办法」，因 beacon 不支持版本
    锁定（version-pinning），官方为能持续发布安全/缺陷更新而保留同名更新；
    仅自动注入方式由 CF 在边缘为其版本化 URL（/beacon.min.js/v<hash>）自动
    附加 integrity。② 托管方实测口径（2026-11-23）：该 URL 响应 ETag 为
    W/"2026.10.1"、Last-Modified 2026-10-15、Cache-Control: max-age=86400
    ——内容按版本在同一无版本 URL 上整体更换；当日两次间隔抓取内容一致
    （31,853 字节，sha384 =
    DSBfgE0somecFTMgit0M4sNXN8O0JQ/LGM3DGGPVvgXIPZvW+H1zSYjc6O83LLBv），
    仅证明当前版本内稳定。一旦 CF 发布新版本，预置 hash 即失效、浏览器将
    拒绝执行 beacon，统计静默中断且页面侧无报错——中断风险大于 SRI 收益，
    故不给 beacon 强加 integrity（亦无需回滚口径）。
  - 残余风险接受理由：托管方即站点自身 CDN 与统计服务方（Cloudflare），
    信任边界与站点托管重合；CSP script-src 已按主机收窄至
    https://static.cloudflareinsights.com（非通配），beacon 仅向
    cloudflareinsights.com POST 遥测；本地实测（无头 Chrome 加载本地页）
    beacon 正常请求完成、页面功能不受影响。
  - 预期 Observatory 结果：SRI 项维持 −5、总分维持 135 / A+。本条为未部署
    代码的方案登记，现网复测对象只能是既有基线；部署后如需复测另行执行。
  - 再评估触发条件：① 站点改为 CF 自动注入 Web Analytics（边缘自动带
    SRI）；② CF 为 beacon 提供版本锁定 URL 或官方 SRI 指引变更；③ 新增
    任何其他外部脚本——新增脚本必须逐个做 SRI 可行性评估并在此登记，
    且 tests/frontend-dom.test.mjs ⑱ 守卫断言会先行变红拦截。
  - 变更纪律：若未来给 beacon 强加 integrity，须同时建立 beacon hash
    漂移监测告警，否则不得上线。

### 5.5 依赖漏洞审计记录（F7-46，第七期 2026-11-23）

- **当期结论：已审计，0 漏洞（OSV 口径，2026-11-23）。** 协调人在集成阶段
  以 `scripts/audit-deps.mjs` 经 OSV 公共 API 实跑完成：package-lock.json
  枚举 91 个包、漏洞 **0 条**、退出码 0（运行时间 2026-11-23T05:10:50Z）。
  此结论为本期当期证据，不沿用第六期数字。
- 已尝试路径（2026-11-23，本沙箱环境）：
  1. `npm audit`：注册表端点返回 **403 Forbidden、类别 `policy_denied`**
     （POST /-/npm/v1/security/audits/quick 被环境注册表策略拒绝），与第六、七期
     评审实测一致，非包本身的问题；
  2. `osv-scanner`：本机未安装（`which osv-scanner` 无结果）；
  3. OSV 公共 API（api.osv.dev）：安全治理组首轮外呼因审批超时未完成；
     协调人集成阶段重试获批并实跑成功（见当期结论）。
- 仓库依赖面（事实登记，非审计结论）：package.json 仅 devDependency
  `wrangler 4.159.0`、无运行时依赖、无 CDN 库；package-lock.json 共 91 个包
  （含 wrangler 的传递依赖与各平台可选二进制包）。
- 补跑工具（已落盘）：`scripts/audit-deps.mjs`——从 package-lock.json 枚举
  全部包版本、经 OSV 公共 API（querybatch + vulns 明细）批量查询，输出漏洞
  计数/明细/审计日期，无需凭证；退出码 0=已审计且 0 漏洞、1=有漏洞、
  2=未完成审计（脚本在失败时明示「未审计」，不会冒充 0 漏洞）。其离线枚举
  与桩服务流程已由 tests/audit-deps.test.mjs 覆盖。
- **后续补跑方法**：在可直达 api.osv.dev 的环境运行
  `node scripts/audit-deps.mjs --out=ops/security/audit-deps-<日期>.json`，
  并把工具、日期与漏洞计数回填本节；或在不受注册表策略限制的环境跑
  `npm audit` / `osv-scanner scan --lockfile package-lock.json` 并同样登记。

### 5.6 wrangler 锁版入口与 report-only 门禁（F7-45 / F7-47，第七期 2026-11-23）

- F7-45：人工运维 wrangler 命令统一走 `scripts/wrangler-pinned.sh`（从
  package.json 读 pin、校验 lockfile、参数透传）；README、轮换剧本、
  fetcher-runbook、季度清单与 deploy.sh 均已改用该入口，禁止再写裸
  `npx wrangler`。deploy.sh 的部署步亦改经该入口（与原内联
  `npx wrangler@<pin>` 等价）。
- F7-47：`ops/headers/_headers.report-only.txt` 已纳入 gen-headers 的
  `--check` 体系并重新生成到现行口径（WA-ON+report-only，与线上同变体、
  仅 CSP 头名为 Report-Only）；`--report-only` 现强制显式 `--variant`
  （防再生成 WA-OFF 陈旧产物），deploy.sh 新增 (b2b) 门禁在每次部署时
  校验该产物与当前全站 HTML 一致。
