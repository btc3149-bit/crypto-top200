# 第三期施工记录 · CONSTRUCTION_PHASE3

- 施工依据：`PHASE3_UI_EVAL.md`（47 条问题 → 25 个工作包），站长 2026-11-12 拍板 P0+P1+P2 一次全做。
- 施工时间：2026-11-12 19:56–20:17 CST，分 7 批施工、每批部署后冒烟+探针+HC2 报到。
- 结论：**23/25 包完成；W3-22 未达（验收硬条件实测不成立，评估留档）；W3-25 暂缓（其自身前置条件未到）**。数据与功能零删减：200 行、排序/搜索/自选/详情/hash 直达/置信过滤全部在位，/api/board、/api/health 契约未动，fetcher 与抓取链未动。
- 部署 ID（production，依次）：`0f17ae61`（批1）→ `38b9f4a4`（批2）→ `b2cc3d60`（批3）→ `9d7c6cc0`（批4）→ `1b665aeb`（批5）→ `6f1ac7e5`（批6）→ `869d5437`（批7，终版）。另有 preview 部署 `bd874c35`（W3-16 缓存头验证专用）。正式地址 https://top200.oppcal.com 。
- 每批固定验收：`tests/snapshot-verify.mjs` 5/5、`tests/test_render_snapshot.py` 8/8、`board.test` 7/7、`board-v2.test` 12/12、`board-fetcher.test` 8/8（批 7 全量复跑）、`gen-headers --check`（WA-ON）通过、`scripts/smoke.sh` 6/6、`scripts/probe.sh` verdict pass、HC2 ping success（每批均 HTTP 200）。
- 施工窗口内 HC1 每小时探针 cron（top200-hc1-hourly-probe）按预期可能有单次失败记录，属部署窗口正常现象，不作故障处理。

## P0 验收五点（部署后线上复核结论）

1. **宽屏核心列完整可见 —— 通过（宽度算术 + CSS 在位证明）**。`.wrap` 上限 1500px、内容区 1472px = colgroup 12 列定宽之和（88+244+72+84+120+70+98+112+152+104+84+244=1472），`table-layout:fixed` 下无截断；1366 档核心依据列按断点收起（详情有副本），其余 11 列定宽和 1228 ≤ 内容区 1338；1280 档 1252 ≥ 1228 同样全列可见。
2. **横滚有提示且币种列冻结 —— 通过（代码与线上产物在位，真机肉眼滚动观感列入待真机清单）**。排名+币种两列 `position:sticky` 冻结（实色背景+分隔阴影+z-index 分层：角部 th z=6 > th z=4 > 冻结 td z=3）；`.tablebox` 两侧渐隐提示层由滚动 JS 按 `scrollWidth/clientWidth` 动态显隐。
3. **回链对比度 ≥4.5:1 —— 通过（脚本复算）**。回链及全站链接现为 `--txt` + 下划线：对卡面 14.98:1、对页面底 16.31:1（W3-04 的 `--acc` 方案 10.72:1 已达标，W3-14 按语义收敛换实现、对比度不降反升）；snapshot 徽标字 #f5a3b0 对卡面 9.08:1。
4. **实时数据到达后不再塌缩 —— 通过（桩测新口径 + 线上代码在位）**。首次实时到达走 `patchInPlace` 按行 id 原地修补（节点不销毁、按实时序重排、详情行随主行移动），并置 `livePatched` 使后续排序/筛选/刷新恒 200 行；`snapshot-verify` ④ 已按新口径改写断言（首次到达即 200 行、行序与 cmpCoins 一致、刷新 ×3 恒 200 无重复）且全过。滚动/焦点保持的真机手感列入待真机清单。
5. **手机端被隐藏列在详情里可达 —— 通过（代码在位）**。`detailHTML` 已补「报告排名」「24h（实时）」「实时市值」三字段（实时缺失时显式标注无实时数据）；≤640 隐去的报告排名/报告现排名/24h/市值/ATH/置信度/核心依据均可在展开详情中读到。

## 逐包记录

### 第 1 批（部署 0f17ae61）
- **W3-04 对比度速修 ✅**：`:root` 加 `color-scheme:dark`；全局链接色达标（先 `--acc`、批 6 按 W3-14 改 `--txt`+下划线，见 W3-14）；`.badge.snapshot` 字色改深色字（后随 W3-17 改纯文本形态）。证据：对比度脚本复算（见上 P0-3）。
- **W3-18 render 守卫 ✅**：`render()` 首行 `if (!COINS.length) return;`；loadBoard 成功路径在 COINS 未就绪时只切快照横幅，不再整表替换。
- **W3-07 覆盖率显性化 ✅**：横幅 `coverageNote()`（覆盖 R/E + 缺失币显示快照价）；市值格与价格格同款「快照价」标记；刷新失败横幅注记所显示数据的时刻；board fetch 加 10s AbortController 超时（含无此全局时的兜底，桩测曾因此抓到一处已修）。

### 第 2 批（部署 38b9f4a4）
- **W3-01 宽度与列策略 ✅**：wrap 1180→1500；`table-layout:fixed`+colgroup 12 列定宽；列序重排为 预估排名→币种→报告排名→报告现排名→现价→24h→市值→ATH→预估区间→倍数→置信度→核心依据（报告双排名相邻成组、币种居第 2 列与排名列连续冻结）；核心依据列断点取 1500（与容器上限联动，比方案建议的 1100–1240 更早收起，理由：避免 1366 主档列宽挤压截断，数据在详情有完整副本、零损失）；单元格左右 padding 10→8（批 6 再收至 7）；币名允许换行。
- **W3-02 横滚提示与冻结列 ✅**：排名+币种 sticky 冻结（left 0/88px，与定版列宽同源；table min-width 1228 保证偏移永不失真）；左右渐隐提示层 + 滚动监听动态显隐（纯 CSS 渐变层 + 约 12 行 JS）。
- **W3-03 纵向滚动容器 ✅**：`.tablewrap{max-height:calc(100vh - 20px);overflow:auto}`，th sticky 在容器内真正生效（z-index 分层已设）；hash 直达 scrollIntoView 逻辑经桩测 ④ 与既有路径回归无碍。

### 第 3 批（部署 b2cc3d60）
- **W3-06 移动端三件套 ✅**：detailHTML 补三字段（见 P0-5）；≤640 列治理：仅留 排名/币种/现价/预估区间/倍数 五列（置信度收进详情、核心依据与 hm 列隐藏），col 定宽和 350px、预估区间可在「–」处换行、币名限宽换行；`.exp` ≤640 命中域 44×44；工具栏 ≤640 紧凑化（gap 6、搜索框弹性占位）。

### 第 4 批（部署 9d7c6cc0）
- **W3-05 首次切换原地修补 ✅**：`rowHTML` 重构为 `rowCells()`+`coinInnerHTML()` 单一实现（整表渲染与原地修补共用，snapshot-verify ② 逐行 diff 仍 =0 作证）；`patchInPlace()` 按行 id 更新 12 个单元格并以节点移动重排，详情行随主行移动；无节点环境退阶为整表渲染全部 200 行（方案写明的退阶口径），两种路径结果契约一致；置 `livePatched` 后 `effectiveLimit()` 恒 Infinity，W2-17 的 50 行默认口径自此废止（与 W3-23 裁决一致）。**测试口径变更留痕**：`snapshot-verify` ④ 的「默认前 50 条」断言与 W3-05 定版冲突，已按方案改写为「首次到达即 200 行」并注明废止原因。
- **W3-11 横幅相对年龄 ✅**：live 横幅改「实时行情 · 约 X 分钟前更新」（复用 `staleMins()` 口径），绝对时间只保留在统计带 `stTime` 一个落点（与 W3-08 分工写死）；stale 横幅原有相对年龄保留；刷新失败注记中的时刻属异常标注、不在此列。

### 第 5 批（部署 1b665aeb）
- **W3-09 三排名可分辨 ✅**：表上新增排名口径微型图例（含「名次大于 200 是补位规则」整句说明）；三排名表头加 `title` 注；报告现排名的「11-10核验」逐格副行删除、改列级口径（图例注明逐币日期见详情，方法区同步修正一处已过时表述）；ATH 日期移入详情（athFullText 本含日期）——与 W3-19 联动。
- **W3-10 † 治理 ✅**：表上/表下/详情三处图例同文（「† 聚合口径约值，不作估算主锚；「未核实」= ATH 未经可靠来源核实，表中不显示数值。」）；† 改为可聚焦按钮（点击滚动至表下图例并高亮），无效的 sup `aria-label` 改为 sr-only「（约值）」文本。JS 与 Python 生成器双路同改，diff=0。
- **W3-19 ATH 副行换跌幅 ✅**：主值仍为 ATH 价，副行由日期改为距 ATH 跌幅 %（JS 用 `_d.athDrop`、Python 用快照价同式计算，200 行双路逐字一致）；未核实/无 ATH 价的行不带副行；ATH 排序按钮补 `aria-label="按距 ATH 跌幅排序"` 对齐新语义（可见文案保留「ATH($)」为列身份）。

### 第 6 批（部署 6f1ac7e5）
- **W3-08 首屏压缩 ✅**：副标题删繁就简至 ≤2 行（被删的快照/核验口径细节在方法区原文俱在，无信息损失）；状态横幅与统计卡合并为一行 `.statband`（横幅弹性占位、统计项按内容定宽的横向条）；`#stTime` 撤销 15px 内联压字；移动端副标题默认折叠 + 「展开说明」切换按钮（桌面端恒显、按钮隐藏）。
- **W3-17 层级与控件形态 ✅**：H1 22→27px；统计值 20/19→18px；刷新按钮改描边次级样式（透明底 + `--acc` 描边字）；不可点徽章（liveBadge、工具栏信息徽章）改纯文本形态（仅状态字色、无 pill 底）。
- **W3-13 数字格式化 ✅**（施工前写死：下标零计数法）：`fmtPrice` 对 p<0.01 输出如 `0.0₅4960`（=0.00000496，下标=首个有效数字前的 0 总数，4 位有效数字）；`fmtMcap` 恒定 3 位有效数字、单位只留万亿/亿——原「$9271万」类四位数万读数消灭（现为 $0.927亿）。JS/Python 双路同改 + 桩测样本：PEPE `0.0₅4960`、BONK `0.0₅2690`、SHIB `0.0₅4370` 与 CoinGecko 读数一致；snapshot-verify ② 对 200 行全部价格/市值/区间逐字比对通过。
- **W3-12 行高与命中域 ✅**（修订 W2-06 全端 44px 定版，已在代码注释留痕）：桌面星标命中域收至 32px（透明 min-width/min-height，不撑行高），≤640 保留 44px；td 纵 padding 8→7px、line-height 1.4，双行行高约 51–52px ≤ 53 目标；`tbody tr:hover` 行高亮（含冻结列同步背景）。
- **W3-14 颜色语义收敛 ✅**：`--acc` 保留点枚举——刷新按钮（描边主操作）、自选开关 `.tab.on` 边框、星标已选色、焦点环、hash 定位 flash 左边线、stale 徽章字色；链接一律 `--txt`+下划线（含方法区与详情内 3 处原内联 `--acc` 链接）；置信「中」改中性 `--txt`；排序箭头改 `--dim`；横幅三态改用 `--okbg/--warnbg/--badbg` 等派生令牌；风险横幅加左侧 3px `--dn` 实色边与 snapshot 横幅区分。涨跌色与已达标配色未动。
- **W3-20 置信度三件套 ✅**（在 W3-14 之后）：筛选下拉补三档计数（全部 200 / 高 4 / 中 39 / 低 157，与 data/coins.json 实际分布核对一致）；「低」单元格加左缘 3px 半透明红色内嵌条（字色不改）；「高」4 币单元格底纹徽标化（`rgba(46,189,133,.13)`）。

### 第 7 批（部署 869d5437；SWR 头先经 preview bd874c35 验证）
- **W3-15 可访问性 ✅**：新增 `--line-strong #5b6a85`（对页面底 3.54:1 ≥3:1），工具栏输入/下拉、`.tab`、`.exp` 边框统一改用；`<main class="wrap" id="mainWrap">` 地标 + skip link；`#resultMeta` 加 `aria-live="polite"`；`aria-controls` 改为展开时才由 `toggleExpand` 设置、收起时移除（静态行与 JS 模板同步去除）；`#liveBadge` 移出 h1（flex 标题行，视觉位置不变）；24h 排序禁用原因写入 `aria-label`。
- **W3-16 性能三件套 ✅**：init 并行化（`loadBoard()` 与 coins 取数同时启动，board 先行到达时在 init 末尾补一次收敛渲染）；`_headers` 模板给精确路径 `/` 加 `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`——先 preview 部署验证（`/` 命中该头 + ETag 在位 + /privacy/ 与 /data/ 未被波及）后才上生产，生产复查同项通过；排序（setSort）与置信筛选改走既有 `scheduleRender`（150ms 防抖 + rAF），与搜索同路径。
- **W3-21 board 缓存口径 ✅（二选一写死：选②）**：保留 `cache:"no-store"`；全页文案核查无「自动更新」类误导表述（唯一的频率表述是方法区「服务端缓存代理，每 120 秒更新」，为服务端事实），横幅/统计带均明示行情更新时间。
- **W3-24 零散包 ✅**：副行字号下限 12px（`.sym` 11→12px）；`th,td` line-height 1.4 已设（WCAG 1.4.12 间距注入实测列真机清单）；4 处新窗口链接补 sr-only「（在新窗口打开）」（回链模板双落点、页脚 CoinGecko、详情 CoinGecko 模板）；`#athLegend` 整句链接改「查看表下图例」动作型短语；图例加「涨跌颜色采用国际惯例：绿涨红跌，与 A 股相反」（未翻转红绿）；`@media (pointer:coarse) and (min-width:641px)` 触控目标 44px；「显示全部」在 resultMeta 旁同步第二份按钮（`showAllBtn2`，与表下按钮状态同步）；`.detail-row dl` 加 `max-width:980px`。

## 未达 / 暂缓（如实记录）

- **W3-22 未达 ❌（已于 2026-11-19 按新线补做完成，见文末「W3-22 + W3-25 补做记录」）**：coins.json 的 rows 位置数组形态未启用。子 agent 隔离实验实测：无损 rows 形态 gzip 下限约 20.0–20.4 KB，方案验收线 ≤16 KB 不可达（根源：reason 等唯一文本的熵下限，评估文档的削减预估与实测不符）；前端 `decodeCoinsData` 现为桩（rows 上线会令逐行 diff 200/200 不一致）；范围外消费方 `functions/api/board.js` 的 `getIds()` 只认对象形态，rows 上线会使 legacy 实时路径恒回退快照。强行启用将违反「/api/board 契约不动」红线，故按失败纪律回退全部实验改动。完整评估与前端补全规格、dataHash 口径建议（口径 A：解码后规范对象数组哈希，dataHash 不变）见 `ops/w322-assessment.md`。后续启用顺序：协调者先落前端+board.js 解码并回归 → 站长裁决 gzip 线（建议按实测改 ≤21 KB）→ 管线一次性联动。
- **W3-25 暂缓 ⏸（已于 2026-11-19 与 W3-22 同批完成，见文末补做记录）**：24h 成交量字段未施工。核查结论：`scripts/compare-shadow.mjs` 只比对价差中位/P95、市值 Top20 集合与覆盖集，新增字段技术上不干扰影子比对口径；但本包须改 fetcher 并重新部署 Worker，正处 G1 影子观察窗（结算 2026-11-14 09:17），按本包自身条件「排在 G1 结算与 G2 决策之后、不得干扰影子观察」，待 G1 结算与站长 G2 决策后再施工（详情行呈现的落点与字段名 `volume24h` 已定版）。

## W3-23 测量结论（只测不改，已回填 ops/perf-baseline.md）

- PSI 匿名配额仍为 429，改用本机 Lighthouse 13.6（chrome-headless-shell）移动端口径：生产组 5 跑中位 **LCP 1.99s（≤2.5 ✅）、CLS 0（≤0.1 ✅）**，INP 实验室不可测（TBT 中位 228ms 仅作参考，不作达标结论）；禁用 board 对照组 LCP 中位 1.73s，board 路径成本约 +0.25s，未达 W2-17 的 0.3s 降级门槛。
- 裁决：**W2-17「快照降级 50 行」预案正式废弃，200 行不删减**，与 W3-05 实现一致。
- 披露：测量窗（20:00–20:07）内生产页正被本期其它批次连续部署，数值为跨版本混合值，但 8 跑全部满足阈值、裁决方向不依赖精密比较；**待冻结后按同口径补跑一组干净基线**替换数值口径（后续事项，非本期未达项）。

## 待真机验证清单（本环境无真机/无头浏览器，如实标注，未冒充已验）

1. 桌面真机：横滚时冻结列阴影与渐隐提示的肉眼观感；1500px 断点上下核心依据列显隐切换的布局跳动感。
2. W3-05 真机：实时到达瞬间滚动位置与焦点保持的手感（节点修补已由代码与桩测结果契约保证，手感须真机确认）；展开详情后 board 到达时详情行随主行移动的实际表现。
3. 手机真机（≤640）：五列布局在 360/390px 宽的实际可读性、预估区间换行、44px 命中域、副标题折叠切换。
4. 读屏实机（VoiceOver/NVDA）：skip link、aria-live 结果数播报、展开时 aria-controls 播报、† 按钮与 sr-only「（约值）」播报顺序。
5. 粘性表头在移动端浏览器键盘/工具栏遮挡下的走查；WCAG 1.4.12 文本间距注入实测（letter/word/line-height 强制值下无截断）。
6. smoke-headers 的 S3（无头浏览器探针）与 WA RUM 204 两项 SKIP 须由浏览器侧补验（历期同口径）。
7. placeholder 真机取色与浅色模式外观（本站为暗色定版，`color-scheme:dark` 已声明）。

## 附：本期全部部署与报到

| 批次 | 内容 | 部署 ID | smoke | probe | HC2 |
|---|---|---|---|---|---|
| 1 | W3-04/18/07 | 0f17ae61 | 6/6 | pass | success |
| 2 | W3-01/02/03 | 38b9f4a4 | 6/6 | pass | success |
| 3 | W3-06 | b2cc3d60 | 6/6 | pass | success |
| 4 | W3-05/11 | 9d7c6cc0 | 6/6 | pass | success |
| 5 | W3-09/10/19 | 1b665aeb | 6/6 | pass | success |
| 6 | W3-08/17/13/12/14/20 | 6f1ac7e5 | 6/6 | pass | success |
| 7 | W3-15/16/21/24 | 869d5437 | 6/6 | pass | success |

终版线上复核（2026-11-12 20:15 CST）：/api/board mode=live、coverage 200/200；首页静态快照行 200；smoke-headers（WA-ON）全部断言通过（S3/RUM 为既定 SKIP，见真机清单第 6 项）。

## 站长裁决记录（2026-11-13）

- **W3-22：按新线补做。** 用户于 2026-11-13 拍板：批准 gzip 达标线改判 ≤21KB，并批准评估（ops/w322-assessment.md 第五节）的扩围规格——前端 decodeCoinsData 按 meta.fields 字段序补全解码、functions/api/board.js 的 getIds() 同步支持 rows 解码、最后一次性管线联动切换；dataHash 采用口径 A（解码后规范对象数组哈希，不变）。排期：不在 G1 影子观察窗内施工，待 2026-11-14 G1 结算且用户定完 G2 后启动（与 W3-25 同队列）。

## W3-22 + W3-25 补做记录（2026-11-19，用户拍板同批启动）

门禁前置：G3 已于当日 10:42 完成（BOARD_READ_MODE=kv），本批施工在 G3 观察期内动了 fetcher——11-21 G3 切换后复核结论须注明此变更。启动前六项核查全过（git 干净且与远端一致 HEAD 2e43513；/api/health ok；/api/board kv 契约 200/200、stale=false；KV health ok、consecutiveFailures=0；quota-log 最新判级 WARNING 非 CRITICAL）。

### W3-22 数据紧凑形态（按 ≤21KB 新线 + 扩围规格）✅

- 落盘切换：`data/coins.json`、`public/data/coins.json`、`workers/fetcher/coins.json` 三份同字节改为 rows 紧凑形态（`{meta（含 fields=FIELDS23）, rows}`，紧凑分隔符）。内部规范形态不变：`scripts/check_meta.py` 新增 `decode_coins()` 为单一解码来源，build/render_snapshot/weekly_check 共用；`scripts/build.py` 的 `emit()` 落盘时编码 rows、`build_meta()` 写入 fields，--emit 与 prior 读取均走解码。
- 消费方联动：前端 `decodeCoinsData` 按 meta.fields 补全解码（零硬编码字段表）；`functions/api/board.js` 的 `getIds()` 同步支持 rows 抽列；`scripts/smoke.sh`、`probe.sh`、`deploy.sh` 门禁 (b4) 改 rows-aware；`gen-paprika-map.mjs`、`verify-paprika-coverage.mjs` 加双形态解码。`coins-list.js` 无需重生成（id 集不变，b4 预演 PASS）。
- dataHash 口径 A 实证：切换前后同为 `sha256:264c2b2074f3677d647309579259c81d2b210661ae3133138747f9e0f9beaac4`；解码往返与旧对象产物逐字段全等（Python roundtrip + contract R2 双证）。
- 实测 payload（gzip，`gzip -c | wc -c` 仓库产物口径）：coins.json 原始 132,138→53,175 B、gzip 24,513→**20,403 B**（达标线 ≤21,504 ✅、收紧后预算 ≤22,500 ✅）；index.html gzip 47,378 B；首屏合计 **67,781 B ≤ 71,000 ✅**。线上实测（CDN 传输字节）：coins 20,254 B、index 46,928 B、合计 67,182 B，同在预算内。
- 测试侧：`contract-real-data.test.mjs` 按其文件头定版完成 rows 常驻改造（fixture 加载解码、② 喂原始产物、④ 解码后算哈希），默认运行由 4 PASS/2 SKIP 转为 **6 PASS/0 SKIP**，--rows 2 PASS；board/board-v2 各加 rows 形态 getIds 用例；frontend-dom、snapshot-verify、test_render_snapshot、weekly_check_test 的 fixture 读取改解码。

### W3-25 详情 24h 成交量 ✅

- 契约增量：`shared/board-schema.js` 的 `normalizeCgMarkets`（`total_volume`）与 `normalizePaprikaTickers`（`volume_24h`）新增 `volume24h`；`functions/api/board.js` legacy 映射与 KV 组装 `assembleV2` 同步透传；前端详情行在「实时市值」后新增「24h 成交量（实时）」（fmtMcap 格式化，缺失显「—（无实时数据）」）。纯新增、向后兼容，/api/health 契约不变，compare 字段门禁（price/mcapUsd）不受影响。
- fetcher 部署版本 `752af715-84a3-4779-802c-829512410693`；新代码首个完整 run（20261119T0540Z）起 KV blob `volume24h` 非空 200/200。
- 线上抽查（/api/board 与 blob 一致）：BTC $31,802,072,825、ETH $10,652,512,215、FIL $65,485,535；与 CoinGecko 直查（同刻 total_volume：31,783,340,213 / 10,656,697,570 / 65,442,303）同量级、差 <0.1%（时点差）。

### 全量回归与部署后验证

- 测试全绿：board 9/9、board-v2 13/13、board-fetcher 8/8、fetcher-branches 24/24、frontend-dom 6/6、snapshot-verify 5/5、contract-real-data 6 PASS/0 SKIP（--rows 2 PASS）、test_render_snapshot 8/8、weekly_check 14/14、check_meta 11 pass。
- 部署：fetcher `752af715`（先行）→ Pages `760d8089-7702-465a-9bf7-0033d4b14216`（index.html 有变，先跑 gen-headers --variant=on）。deploy.sh 内建 smoke 全过、probe verdict=pass；HC2-top200-deploy 报到 success。
- 部署后：/api/board 仍 kv 契约 v2（mode=live、stale=false、coverage 200/200、fetch.fetchRunId 与当前 blob 对齐）；compare-shadow（G3 口径：以 current blob 为比对输入）**verdict=pass**（aligned、timeSkew 0s、compared 200、top20SameSet=true、failReasons 空）；UptimeRobot M1–M4 全 up（status=2）。
- 备注：① `v1:board:shadow` 自 2026-11-18T23:50Z 起未再更新（G3 后影子链停写、属既定形态），本次 compare 按 G3 验证同口径执行；② 施工期间 KV 直读曾出现边缘一致性抖动（同一键先后读到 0550Z/0520Z 两种 runId），最终以 blob 直读 + /api/board 的 fetchRunId 交叉确认定论，线上服务未受影响。
