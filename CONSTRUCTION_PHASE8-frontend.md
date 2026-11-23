# 第八期修复 · 前端路施工记录（CONSTRUCTION_PHASE8-frontend）

- 范围：批 5 四条——F8-05（确认）、F8-06 / F8-07 / F8-08（疑似，先定性后处置）
- 分支：p8-frontend（worktree `~/workspace/phase8-wt/frontend`）；未部署、未 push、未 merge
- 取证口径：本环境无真机/无头浏览器，与评审一致——CSS 级联计算 + CSSOM 断言双路；DOM 行为以 tests/frontend-dom.test.mjs 桩 DOM 实跑（修前红 → 修后绿为定性证据）
- 结果：4 条全部确认并修复（疑似 3 条无一证伪）；全量 `./scripts/run-tests.sh` **22/22 套件全绿**，frontend-dom 由基线 20 项增至 **24/24**（新增 ⑳㉑㉒㉓）
- 提交（逐条）：fdfd584（F8-05）、db54e2f（F8-06）、4b190e0（F8-07）、bb2cb32（F8-08）、8dcaf18（_headers 再生）

## F8-05 ≤640 手机档排序按钮仍 36px（确认 → 已修）

- 修前实测（CSSOM 级联计算，与评审复现口径一致）：视口 360/390/640px（粗指针）下 `.th-sort` 计算 min-height 均为 **36px**；同档对照组 `.toolbar button` / `.sub-toggle` / `.toolbar input[type=search]` 均为 **44px**；1024px 粗指针为 44px（F7-36 规则，限定 min-width:641px）、1280px 细指针为 36px（基础档定版）。
- 级联陷阱：第一 ≤640 媒体块位于基础 `.th-sort` 规则之前，同特异性会被后写基础规则覆盖（W5 教训形态）；修复写入基础规则**之后**的第二 ≤640 媒体块。
- 修法：第二 ≤640 块新增 `.th-sort{min-height:44px}`（public/index.html，附 F8-05 注释）。
- 修后实测：360/390/640px 计算 min-height 均为 **44px**（粗/细指针同值，本档不分指针类型）；1280px 细指针仍 36px、1024px 粗指针仍 44px，非目标档零扰动。
- 布局回归核查：
  - 五列总宽：修前 326px → 修后 **326px**，列宽逐项不变（rank 34 / coin 98 / price 64 / est 62 / mult 68），≤330 断言与 360px 视口不横溢口径不变（F7-37 定版未动）。
  - 行高：表头行高由 #thRank 折行内容主导——内容宽 24px（34 − th 内边距 2×3 − 按钮内边距 2×2）、10px 字号 line-height 1.3、break-all 折 3 行 = 39px + 按钮上下内边距 8px ≈ **47px ≥ 44px**，故 min-height 36→44 不抬高表头行；正文行无 .th-sort，不受影响。
  - 固化：frontend-dom 新增 ⑳（CSSOM 级联计算断言：三档 44 / 桌面 36 / 粗指针 ≥641 保持 44 / 五列逐项与总宽断言）。

## F8-06 状态横幅 aria-live 每次 render 无条件重写（疑似 → 确认 → 已修）

- 定性证据：桩 DOM 以 accessor 计数 textContent 写入（桩无 MutationObserver，此为与评审「MutationObserver 计数」同义的等价口径）。修前：快照态同状态连续 `render()` 3 次，横幅 textContent 被写入 **3 次**（值不变亦重写属实，回归用例修前红灯，断言信息原文「实际 3 次」）。
- 修法：`applyBoardState()` 四分支（live/stale/delayed/snapshot）改为先算 `bannerText`，分支后统一 `if (banner.textContent !== bannerText) banner.textContent = bannerText;`；className 与其余元素写入行为不变。snapshotFail/liveLayerFail 为状态切换点直写，不在 render 循环内，未动。
- 修后实测：frontend-dom ㉑——同状态 3 次 render 额外写入 **0 次**；切 live 后横幅仍被写入并变为实时文案（状态变化路径完好）。

## F8-07 Escape 关闭详情以未转义 id 拼 querySelector（疑似 → 确认 → 已修）

- 定性证据：按评审验证方法，本地注入 `coingeckoId = "a'b"` 的币并置展开态，在其详情行派发 Escape——修前拼接出 `[data-exp='a'b']`，querySelector 抛 **SyntaxError**、handler 中断、详情未关（frontend-dom ㉒ 修前红灯，堆栈原文 `'[data-exp='a'b']' is not a valid selector`）。桩 querySelector 在用例内以浏览器语义替身（单引号字符串须闭合且紧跟 `]`、反斜杠转义按 CSS 字符串规则还原）。
- harness 配套：document 桩 `addEventListener` 此前为空转、keydown 链不可测，现改为记录监听器（`_listeners`），仅增记录、不改其余桩语义。
- 修法：新增 `escSelStr()`——`CSS.escape` 可用则用之（浏览器路径），否则手写等价转义（`\` → `\\`、`'` → `\'`，桩环境走此路）；Escape 处理改用 `"[data-exp='" + escSelStr(id) + "']"`。
- 修后实测：㉒ 全绿——畸形 id `a'b` 不抛错、详情关闭、`aria-expanded` 同步 false、焦点回到展开按钮；正常 id（bitcoin）Escape 关闭行为不变。

## F8-08 隐私页无 `<main>` 地标、无跳过链接（疑似 → 确认 → 已修）

- 定性证据：结构核对——隐私页修前 `<main>` 计数 **0**、skip-link **0**、`<div class="wrap">` 1；首页对照各 1。属实。
- 修法：`<div class="wrap">` 改为 `<main class="wrap" id="mainWrap">`（`.wrap` 样式原样承接，视觉不变）；body 首位补与首页同文案同锚点跳过链接 `<a class="skip-link" href="#mainWrap">跳到主内容</a>` 及同口径 `.skip-link` 样式（平时移出视口、`:focus` 显形；边框色取本页调色板 `--line`——本页无首页的 `--line-strong` 变量，为唯一口径适配）。
- 修后实测：隐私页 `<main>` 计数 **1**、`<div class="wrap">` **0**、跳过链接在位且位于 `<main>` 之前；frontend-dom ㉓ 结构断言（含首页对照基准）全绿。

## 派生产物与纪律

- `public/_headers` 已按纪律再生：`node ops/headers/gen-headers.mjs --variant=on`（index.html 内联 script/style 与隐私页 style 均变更、CSP hash 更新），`--check` 通过后随 8dcaf18 提交。
- 仓库派生 report 产物 `ops/headers/_headers.report-only.txt` 经 `--check --report-only` 提示不一致，已按仓库自有脚本 `node ops/headers/gen-headers.mjs --report-only --variant=on` 再生并一并提交（8dcaf18），复检通过。
- 文件边界：仅改 public/index.html、public/privacy/index.html、public/_headers（再生）、ops/headers/_headers.report-only.txt（再生）、tests/frontend-dom.test.mjs；未触 functions/**、shared/**、workers/**、scripts/**、ops/headers/*.mjs 本体、coins-list.js、tests/suites-manifest.json、tests/kv-write-guard.test.mjs。
- 验证总账：`./scripts/run-tests.sh` **22/22 套件通过**（与基线套件数一致，无新增套件、无 manifest 变更需求）；frontend-dom 24/24（基线 20 + 新增 4）。
