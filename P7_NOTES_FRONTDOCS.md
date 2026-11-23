# P7_NOTES_FRONTDOCS — 第七期批 3 前端 + 批 5 文档同步施工记录（分支 p7-frontdocs）

范围：F7-34、F7-35、F7-36、F7-37、F7-38、F7-39、F7-40、F7-41、F7-43（仅前端部分）、F7-48~F7-57。
未改：`functions/`、`workers/`、`scripts/`（含 fetcher README、fetcher wrangler/coins-list 注释，归 data 组）；未部署、未 push。

## ⚠️ 协调人必读（部署前）

1. **gen-headers 未执行（有意留给部署前统一处理）**：本批改了 `public/index.html`（内联脚本/样式与一处新增 style 属性），`node ops/headers/gen-headers.mjs --check --variant=on` 现报不一致：index.html sha256 变化、CSP 两枚 hash 变化、style 属性计数 5→6（新增的页脚隐私链接带一处 style）。正式部署前必须先跑 `node ops/headers/gen-headers.mjs --variant=on` 重新生成 `public/_headers`，否则 deploy.sh 的 W2-18 门禁会中止。本批对 `public/_headers` 只改了 F7-57 的注释行（与模板同字），未手改任何头值。
2. **tests/frontend-dom.test.mjs 与 guard 组同文件协作**：本批只动了两小段——⑰ 断言改写（F7-34 四值 inset）与文件末尾新增 ⑲（F7-35/36/37/38 定版断言），其余段落未碰；合并时若 guard 组也改了 ⑰/末尾段，按条目号对齐即可。
3. **README 只处理 F7-55 两处**（deploy 流程段重写、删除现状注记），未动 README 中手工 `npx wrangler` 锁版行（security 组 F7-45 范围），避免整行冲突。附带观察（不在本批范围、未改）：README 开头与「包里有什么」的 board.js 行仍有「服务端代理/缓存 120 秒」旧文案，与 F7-39 同类，建议协调人确认归属后另行处理。

## 逐条证据

### F7-34 .exp::after 横向收敛（public/index.html）
- 改：`.exp::after` 由 `inset:-8px` 改为 `inset:-8px -4px -8px -8px`，注释写清几何：`.exp` margin-right 4px、星标左缘 = .exp 右缘 + 4，右扩 4 恰填间隙止于星标左缘，不再蚀星标 4px。
- 有效命中域：宽 28+8（左）+4（右）= **40px** × 高 28+2×8=**44px**。说明：横向 44 在「不侵星标、不改布局」约束下不可达（右扩上限即 4px 间隙），40 为最大值；纵向维持 44，本体 44 的两档（≤640、粗指针）仍 inset:0 恰 44×44 不变。
- 验证：frontend-dom ⑰ 改写后断言四值 inset、纵向 =44、右扩 =4、横向 =40、margin-right 前提，全绿。

### F7-35 ATH † 按钮命中域（public/index.html）
- 改：`button.ath-flag` 加 `position:relative` + `::after{inset:-16px -12px}` 透明扩展。视觉字形（10px、约 9×13 盒）与行高/布局零变化；有效命中域约 33×45px（高 ≥44 目标、宽高均 ≥WCAG AA 24）。扩展只覆盖同格价格/跌幅区域（同格无其他交互元素），点击行为仍走既有 `[data-athflag]` 图例滚动逻辑，未改 JS。
- 验证：frontend-dom ⑲ CSS 断言在位，全绿。

### F7-36 粗指针 .th-sort 44px（public/index.html）
- 改：`@media (pointer:coarse) and (min-width:641px)` 规则集追加 `.th-sort{min-height:44px}`（基础档仍 36px 不变）。
- 验证：frontend-dom ⑲ CSS 断言，全绿。

### F7-37 ≤640 首列表头可见 + 五列一屏（public/index.html）
- 改：删除 `#thRank` 的 clip 视觉隐藏，改为 10px 字号、`word-break:break-all` 折行可见（排名列内容宽 = 34 − th 内边距 2×3 − .th-sort 内边距 2×2 = 24px，每行 2 字；按钮 aria-label 不变，排序可辨）。
- 列宽定版：rank 34 + coin 98 + price 64 + est 62 + mult 68 = **326px ≤ 330**（360 视口 tablewrap clientWidth≈330），390 视口（≈360）更宽裕；同步 th,td 内边距收至 6px 3px、表字号 12px、冻结列 left 同步 36→34px。币种列内容宽 92px ≥ 展开钮 44 + 星标 44，两钮不折行。
- 不变量：隐藏列 `<col>` 与单元格同步 display:none 的既有规则一字未动（防三期列宽错配复发）；存活列与 col 一一对应关系不变。
- 验证：frontend-dom ⑲ 断言五列总宽 ≤330、无 clip 规则、#thRank 可见字号规则，全绿。本环境无无头 Chrome，几何以 CSS 算术 + 断言验证（与既有 ⑰ 的验证方式同级），真机/无头复测建议随部署冒烟一并做。

### F7-38 decode 全行校验（public/index.html，先复现后修）
- 复现（报告方法）：把 data/coins.json 第 50 行 symbol 改为数字 123 后在 vm 桩环境加载页面脚本——修前 `decodeCoinsData` 放行 200 条、`parseHashTarget()` 抛 `TypeError: x.symbol.toUpperCase is not a function`，与报告一致（疑似 → 确认成立）。
- 修：① `decodeCoinsData` 新增 `validateAll` 全行校验（两种形态共用）：任一行 coingeckoId 非非空字符串 / symbol 非非空字符串 / estRank 非有限数即整表 throw，走 init 既有快照兜底；② `parseHashTarget` 对 symbol/coingeckoId 加 typeof 守卫（畸形行跳过不抛错）；③ `syncHashForExpand` symbol 非字符串以空串代行；④ 新增 `cmpRankTie`，cmpCoins 的 tie-break 经 `num()` 归一，缺失沉底、双缺失返回 0，不产 NaN。
- 修后复跑同一复现脚本：`decodeCoinsData` 直接抛 `coins schema invalid: row fields`（快照兜底路径），不再放行。
- 验证：frontend-dom ⑲（第 50 行 symbol=123 throw、estRank 字符串 throw、畸形 COINS 下 parseHashTarget 不抛错、cmpRankTie 有限值）+ ⑩ 既有校验用例，全绿。现行真实数据 200 行全合规（全套件绿即证）。

### F7-39 页脚/隐私页数据更新文案（public/index.html、public/privacy/index.html）
- 首页页脚：「经本站服务端缓存代理，每 120 秒更新」→「由本站抓取服务约每 10 分钟抓取一次并写入缓存，本站页面只读缓存组装榜单，不逐次回源」。
- 隐私页第四节：删除「服务端函数向 CoinGecko 拉取/缓存 120 秒」口径，改为 fetcher 约每 10 分钟抓取写缓存、`/api/board` 只读缓存组装、新鲜度以 10 分钟节奏为限。

### F7-40 隐私页可达 + 自选披露定版（public/index.html、public/privacy/index.html）
- 首页页脚新增 `<a href="/privacy">隐私说明</a>`（此前首页 `/privacy` 命中 0 处）。
- 隐私页第五节：删除「[待 W2-06 前端包落地后复核]」注释与「若您使用/预定为」预写口径，改为已上线定版：键名 `top200.watchlist.v1`（与代码 `WATCH_KEY` 逐字一致）、只存本机、不上传。
- 页首「最后更新」2026-11-11 → **2026-11-23**。

### F7-41 sitemap lastmod（public/sitemap.xml）
- 两条 URL 的 lastmod 2026-11-10 → **2026-11-23**。
- 低风险自动化方案（只提方案、未改 deploy.sh，他人负责）：在 deploy.sh 的 (d) 冒烟通过后或 gen-headers 同步点，加一步「以部署日重写 sitemap.xml 两处 lastmod 并纳入同次部署」的生成脚本（类似 gen-headers 的 --check 门禁防漂移）；因 sitemap 须与页面同批上线，重写必须发生在部署打包之前（即与 gen-headers 同阶段），不能部署后补改。本批未实施。

### F7-43 前端 init coins fetch 超时（public/index.html，仅前端部分）
- 改：init 的 `fetch("data/coins.json")` 加与 loadBoard 一致的 10 秒 AbortController（无 AbortController 环境回退无 signal 直拉），并补 `res.ok` 检查；超时/失败落入既有 catch：console.error 留信号 + showSnapshotFallback 快照横幅，降级方向不变。board.js 侧 getIds 超时归 API 组，本批未碰 functions/。

### F7-48 台账/legacy counter 文档（ops/quota-ledger.md、ops/legacy-measured-counter-w5.md）
- legacy-measured-counter-w5.md：末段「尚未部署」改为已随 W5 Pages 部署 `eba9cb0d` 上线生效（quota-check 实测 legacyMeasured、kv 形态 available=false 属预期），并标注文首「激活前」核查节为历史段。
- quota-ledger.md：:69 段「仍未激活」加历史口径标注（2026-11-14 时点、已被 W5 supersede）；W5 段「尚未部署」改为已部署生效；「计量方法」legacy 行同步改为实测优先口径。

### F7-49 security-baseline §5.1/§5.2（ops/security/security-baseline.md）
- §5.1：删除「board.js / health.js 均只 get」的现行误述，登记 W5 唯一批准 put 例外（board.js 仅对 `v1:meta:legacy-credits` put、kv 形态不触发、delete 全面禁止），与根 wrangler.toml 注释、kv-write-guard 逐点核准口径对齐。
- §5.2：硬性检查项改写为「只允许该唯一例外，其余 put 与一切 delete 不得出现」。

### F7-50 security-baseline Observatory 口径统一（同文件 §3.3）
- §3.3 原「未过项待确认」与 §5.4 定版矛盾——统一以 §5.4 为准：唯一未过项即 SRI（−5）、已接受现状销项；原表述标注为定版前历史状态，并注明与 §3.2 的 −10 CSP 扣分为两个不同扣分项、ACAO 已由复测记录排除。

### F7-51 Pages wrangler.toml 注释（wrangler.toml）
- 「BOARD_READ_MODE（缺省 legacy）」→ fail-closed 现行口径：缺失/未识别时回退快照 v2 应答，不按 legacy 尝试。
- 「legacy 模式 key 缺失时仍按匿名尝试」→ 已被 F6-03 推翻：现行抛配置错误、禁止匿名。仅改注释，未动任何配置值（[vars] 仍 kv）。

### F7-52 fetcher-runbook 三处（docs/fetcher-runbook.md）
- ① 开头数据流与「KV 坏数据」形态段的无例外「只读」表述，补 W5 唯一写例外（与 wrangler.toml 口径齐）。
- ② 额度击穿处置第 1 步：legacy 侧改为先读 W5 实测计数（legacyMeasured / legacy-credits 键），不可得才估算；删除「无自动记账」现行表述。
- ③ KV 键集：四键 → **7 键**（current/shadow/currentPrev/shadowPrev/health/sourceState/legacyCredits）；prev 写入按代码证据谨慎表述——fetcher 代码已按 W4-10 写 blob 前归档 prev（prev 写失败不阻断），但本节未做 KV 原始键直读核验，且「以 prev 一键回滚」无定版流程/演练，仍不得按可回滚处置，prev 只作比对/取证。

### F7-53 oncall-handbook（ops/oncall-handbook.md）
- §1 结构速览改以 **kv 现行形态（G3）起头**，legacy 降为回滚形态；部件表 fetcher 行改现行写 current、KV 行键集更新为 7 键。
- §2 健康入口表新增 **HC4 行**（判据 period 1h/grace 20m、lastSuccessAt ≤25 分钟且 consecutiveFailures ≤2、正文指向 probe-config HC4 行与 fetcher-runbook），并标注 G3 后 HC4 监控的是生产数据链；§5 凭据表 ping URL 范围 HC1–HC3 → HC1–HC4。

### F7-54 probe-config（ops/probe-config.md）
- HC4 落地条：「影子链异常不影响当前 legacy 线上路径」→ G3 后该链即生产数据链、异常按生产故障处置（检查名中 shadow 为历史命名沿用）。
- 落地状态节：核对范围 HC1–HC3 → HC1–HC4（HC4 参数已入同表），并注明本节标题日期为原落地时点、HC4 部分以修订日期为准。

### F7-55 README（README.md）
- 删除第 11 行现状注记（其自述删除条件——Wrangler 直推重新部署——2026-11-10 当日已满足，注记与线上 live 状态矛盾）。
- deploy.sh 流程段按现行实现重写：测试门禁（最前置）→ 脏工作区门禁 → 模式门禁（production 须 kv）→ 工具链预检 → 数据门禁 → _headers 门禁（gen-headers --check）→ 部署 → smoke + smoke-headers 段 → probe；绕过口径改为现行「须 DEPLOY_SKIP_REASON + 自动落 ops/deploy-log.jsonl，无理由拒绝」，删除旧「DEPLOY_SKIP_META_CHECK=1 单次生效并须在 CHANGELOG 注明」口径。
- 未动 README 的手工 wrangler 锁版行（F7-45，security 组范围，防整行冲突）。

### F7-56 测试文件头与落库记录口径（tests/quota_check_test.py、tests/contract-real-data.test.mjs、docs/paprika-mapping-landing-2026-11-23.md）
- quota_check_test.py 文件头：删除「仍以 legacy 576 判级、待批 0 合并后转绿」的预期红误述，改为批 0 已合并、kv 口径 6/6 全绿的现行状态（历史沿革指向 P6_NOTES）。
- contract-real-data.test.mjs 文件头：守护对象 FIELDS23 → **FIELDS24**（两处）；NULLABLE 分布注释按现行 public/data/coins.json 于 2026-11-23 重新对账（rankNow 6、rankNote 193、snapshotMcapUsd 1、athPrice 36、athDate 35、implied 各 1、新增 paprikaId 4——逐项以脚本实数核对，非沿用旧数）。
- paprika-mapping-landing 尾节加口径注：其「14/14 套件、169 项」为 C 路分支时点口径，现行主干基线为 **15/15 套件、178 项（2026-11-23 时点，第七期评审实测）**，引用须注明时点。

### F7-57 _headers 注释（ops/headers/_headers.tmpl、public/_headers）
- 两文件注释「security headers live in functions/api/board.js SECURITY_HEADERS」→「defined once in shared/http.js (SECURITY_HEADERS, F6-33 起单一定义；board.js / health.js 共用)」。已核 shared/http.js:4 为定义源、board.js:37 与 health.js:24 均 import 之。public/_headers 仅改该注释行（生成器从模板同字复制该行，重新生成后不回退；头值未动）。

## 测试

- `node tests/frontend-dom.test.mjs`：**20/20 PASS**（原 19 + 新增 ⑲；⑰ 按 F7-34 改写）。
- `bash scripts/run-tests.sh`：**15/15 套件全绿**（含 contract-real-data、quota_check 6/6、kv-write-guard、legacy-credits 等全部相关套件）。
- `node ops/headers/gen-headers.mjs --check --variant=on`：如上「协调人必读」所述报不一致（index.html 变更所致），属预期，待部署前重新生成。
