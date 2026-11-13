# W4-21 隐私承诺逐项对照表 · wa-consistency-table

- 对应发现：`PHASE4_REVIEW.md` F4-32 / 工作包 W4-21（P2，批 4）。
- 对照对象：`public/privacy/index.html`（已启用版，页首「最后更新：2026-11-11」，
  文件共 87 行，下称「隐私页」，行号以本表基准提交为准）。
- 基准提交：`b552973`（第四期 fetcher 代码准备，未部署）。本表只做文档对照，
  不改隐私页文案、不改任何代码；发现的不一致一律列为待办、由后续批次
  经站长确认后改文案或改实现，不在本包内粉饰或顺手修复。
- 实查范围（仓库内）：`public/index.html`、`public/privacy/index.html`、
  `functions/api/board.js`、`ops/headers/gen-headers.mjs`、`public/_headers`、
  `ops/signoffs.md`、`CHANGELOG.md`，以及全仓前端/函数范围内的
  `cookie` / `localStorage` / 第三方统计脚本关键词检索。
- 口径说明（贯穿全表）：
  - **平台文档口径、本仓库不可验**：凡结论依赖 Cloudflare Web Analytics
    （下称 WA）beacon 脚本本体行为、Cloudflare 侧数据留存/聚合/仪表盘的，
    一律标此口径。理由：beacon 是从 `static.cloudflareinsights.com` 加载的
    外部脚本，其源码不在本仓库；本仓库只能证明「注入点、令牌、CSP 放行域」
    这些本站侧事实，证明不了脚本在 Cloudflare 侧实际采集/留存了什么。
  - 结论图例：✅ 一致（仓库可验）｜◐ 基本一致／附注（大方向成立，
    有口径简化或流程性保留）｜⚠ 平台口径不可验（仓库内无证据可证真伪）｜
    ❌ 不一致／待办（文案与实现对不上、或承诺本身未完成）。
- 维护规则（W4-21 验收要求）：每次统计相关变更（beacon 注入点增减、
  WA 开关、CSP WA 变体、采集目的变化）必须同步更新本表并复核受影响行；
  只改代码不改本表视为该次变更未验收。

## 汇总（先给结论）

- 对照项总数：**24 项**（P-01～P-24，按隐私页章节顺序逐项拆分）。
- ✅ 一致（仓库可验）：10 项（P-01、P-02、P-03、P-05、P-11、P-13、P-14、
  P-16、P-19、P-21）。
- ◐ 基本一致／附注：4 项（P-15、P-18、P-22、P-23）。
- ⚠ 平台文档口径、本仓库不可验：6 项（P-06、P-07、P-08、P-09、P-10、P-12）。
- ❌ 不一致／待办：**4 项**（P-04、P-17、P-20、P-24），详见文末待办清单。
  这 4 项在本包内**只登记、不修复**；其中 P-04、P-24 属文案自身缺口，
  P-17、P-20 属文案与代码细节对不齐。

## 逐项对照

| 编号 | 承诺原文要点（隐私页出处） | 对应实现证据（文件/行号或配置） | 一致性结论 |
|---|---|---|---|
| P-01 | 适用域名仅 `top200.oppcal.com`；最后更新 2026-11-11（隐私页:26） | 隐私页 `<link rel="canonical" href="https://top200.oppcal.com/privacy">`（隐私页:8）；仓库内无其它域名版隐私页；beacon 令牌在首页与隐私页为同一枚（见 P-05） | ✅ 一致（仓库可验）。注：「最后更新」日期是否与最近一次文案变更同步属流程项，见 P-23 |
| P-02 | 当前状态：WA 已启用，2026-11-11 经站长签收后启用（隐私页:27） | `ops/signoffs.md:12` U7 签收行（signed，站长明确回复「同意启用统计」）；`CHANGELOG.md` 2026-11-11 W2-14 条目（API 建站＋手动注入 beacon＋CSP 切 WA-ON）；`public/_headers:2` 头注 `variant: WA-ON`；两页 beacon 均在位（P-05） | ✅ 一致（仓库可验） |
| P-03 | 无账号系统、无广告、无付费功能（隐私页:31） | 全仓前端/函数检索无登录/注册/支付代码；`public/_headers` CSP 含 `form-action 'none'`；首页与隐私页的脚本仅有本站内联脚本与 WA beacon 一枚外置脚本，无广告脚本 | ✅ 一致（仓库可验，限「仓库内无反证＋有正向约束」口径） |
| P-04 | 一句话总览：**只有两条数据流**——聚合流量统计与榜单数据代理（隐私页:36） | 隐私页自身第五节标题即为「五、**数据流三** · 浏览器本地存储」（隐私页:53），且该节描述的 localStorage 自选确为本站实际数据处理（`public/index.html:459-480`）；即本站实际有三类数据处理，总览却说「只有两条」 | ❌ **不一致／待办 T-1**：总览计数与本页第五节自相矛盾。修法二选一（改总览为「三条／两条联网数据流＋一条本地存储」或等效表述）须后续批次定版，本包不改文案 |
| P-05 | 页面加载时从 `static.cloudflareinsights.com` 加载 beacon 脚本（隐私页:41） | 首页注入：`public/index.html:1111`（`script type='module' src='https://static.cloudflareinsights.com/beacon.min.js'`，`data-cf-beacon` 令牌与隐私页同枚，令牌值不在本表抄录）；隐私页注入：`public/privacy/index.html:85`（同形态、同令牌）。**注入范围共 2 页：首页＋隐私页**，仓库内无第三个 HTML 页面带此注入。CSP 放行：`public/_headers` `script-src` 含 `https://static.cloudflareinsights.com`（WA-ON 变体专属，生成逻辑 `ops/headers/gen-headers.mjs` 中 `variant === "on"` 时才拼入该域） | ✅ 一致（仓库可验）。附注：隐私页未向访客逐页列明「哪几页带 beacon」，访客只能从本表得知注入范围为首页＋隐私页两页 |
| P-06 | beacon 把聚合信号回传本站的 `/cdn-cgi/rum` 路径（隐私页:41，原文自注「按 Cloudflare 官方口径」） | 仓库内无该回传路径的任何代码/配置：`/cdn-cgi/rum` 由 Cloudflare 平台在 Zone 层提供，不在本仓库；CSP 侧可旁证的只有 `connect-src 'self' https://cloudflareinsights.com`（`public/_headers`；`gen-headers.mjs` WA-ON 时拼入 `https://cloudflareinsights.com`）——`'self'` 覆盖同源的 `/cdn-cgi/rum`，额外放行的 `cloudflareinsights.com` 是 beacon 的回传域之一，但「实际回传到哪个路径」在本仓库看不到 | ⚠ 平台文档口径、本仓库不可验。禁止以 CSP 放行域反推回传路径已证实 |
| P-07 | 采集项仅为：页面路径、来源站（referrer）、国家/地区、设备/浏览器/操作系统粗分类、页面加载性能与 Core Web Vitals（LCP/INP/CLS 等）（隐私页:42） | beacon 脚本本体为外部文件，不在本仓库；本仓库无任何字段级采集代码可对照（本站内联脚本 `public/index.html:452-1110` 不做流量统计采集）。字段清单只能来自 Cloudflare 官方文档 | ⚠ 平台文档口径、本仓库不可验。如 Cloudflare 调整 WA 字段口径，本仓库不会有任何信号，须靠人工定期核对官方文档（见待办 T-5） |
| P-08 | WA 无 Cookie、无本地存储、无指纹识别、不跨站追踪、不记录 URL 查询串（隐私页:42） | 本站自身代码部分可旁证：前端/函数范围检索 `document.cookie` 零命中（见 P-19）；本站 localStorage 写入仅有自选键与瞬时探测键（见 P-20），与 WA 无关。但「beacon 本身不用 Cookie/存储/指纹、是否记录查询串」取决于外部脚本行为 | ⚠ 平台文档口径、本仓库不可验（本站代码无反证，但证不了 beacon 本体） |
| P-09 | 数据留存：未采样原始 beacon 数据保留 7 天，之后聚合保存，仪表盘可查过去 6 个月（隐私页:42） | 本仓库无 Cloudflare 账号侧留存配置、无仪表盘导出物；`ops/` 下无 WA 留存/仪表盘记录文件。此为 Cloudflare 平台侧行为 | ⚠ 平台文档口径、本仓库不可验，禁止编造本仓库的「核实记录」 |
| P-10 | 本站只能看到聚合报表，看不到单个访客的记录（隐私页:42） | 本仓库无 WA 仪表盘访问代码或记录；「能看到什么」取决于 Cloudflare 账号侧仪表盘权限与产品形态，仓库不可验 | ⚠ 平台文档口径、本仓库不可验 |
| P-11 | WA 用途仅为了解访问量与页面性能，不用于广告或画像（隐私页:42） | 仓库内无广告投放、无画像、无第三方营销代码（检索无 Google Analytics / 广告类脚本，见 P-21）；WA 在本站的唯一落点是两页 beacon 注入（P-05）。用途属站长政策声明，代码侧无相反用途 | ✅ 一致（政策声明＋仓库内无反证）。注：政策变更无法靠代码自动发现，靠本表维护规则兜底 |
| P-12 | 读数边界：广告拦截器屏蔽该脚本域名、部分网络下脚本加载失败时，这些访问不计入统计；统计只看趋势、不代表全部访客（隐私页:43） | 该行为取决于访客端拦截器与 Cloudflare 侧计数逻辑；本站代码在 beacon 加载失败时无任何兜底上报（内联脚本不引用 beacon 状态），与「失败即不计入」不矛盾，但计入与否本身仓库不可验 | ⚠ 平台文档口径、本仓库不可验 |
| P-13 | 浏览器不直连 CoinGecko，只请求本站同源接口 `/api/board`，由服务端转发；CoinGecko 一侧看到的是本站服务器的请求而非访客身份（隐私页:48） | 前端取行情唯一 fetch：`public/index.html:951` `fetch("/api/board", { cache: "no-store", ... })`；前端无对 `api.coingecko.com` 的请求（页面内 CoinGecko 字样为数据来源标注，以及详情/页脚指向 `www.coingecko.com` 网页的人工点击外链——那是访客主动导航、不是行情数据直连，建议文案后续可加一句区分，见待办 T-6 附注） | ✅ 一致（仓库可验） |
| P-14 | 行情由本站服务端函数向 CoinGecko 拉取后转发（隐私页:48） | `functions/api/board.js:211-227` `fetchUpstreamInternal` 请求 `https://api.coingecko.com/api/v3/coins/markets` 与 `/api/v3/global`，API key 经 `env.COINGECKO_API_KEY` 以请求头注入（board.js:218，key 值不在本表抄录） | ✅ 一致（仓库可验） |
| P-15 | 行情结果在服务端缓存 120 秒，缓存期内多人共用同一份数据（隐私页:49） | legacy 路径精确对应：`functions/api/board.js:65` `CACHE_TTL_SEC = 120`，新鲜期判断在 board.js:461。**附注**：现行 board.js 还有 KV blob 路径（G1/G2 影子期双读），该路径的 Cache API 写入为 `max-age=${CACHE_TTL_SEC}`（board.js:564），但 KV 读本身带 `cacheTtl: 60`（board.js:555），且对外响应的 `cache-control` 为 `s-maxage=120` 等组合值（board.js:73）——「120 秒」是面向访客的简化口径，与主口径相符，但不是全链路唯一的缓存数字 | ◐ 基本一致／附注：文案简化可接受；后续若 G3 切 KV 为唯一路径，须复核本行表述是否仍成立（列入待办 T-5 的复核触发点） |
| P-16 | 上游故障时回退最近一次成功数据并明确标注缓存/快照状态，不把旧数据冒充实时（隐私页:49） | `functions/api/board.js` `fallbackResponse`（:396-412）、`staleBody`（:366 起，带 age/coverage 标注）、`snapshotBody`（:343 起）；前端 `boardMode()` 与横幅三态在 `public/index.html:566` 起、:606 起 `applyBoardState` | ✅ 一致（仓库可验） |
| P-17 | 服务端函数不记录、不存储访客 IP 地址；运行日志仅包含错误类型、上游状态码与耗时（隐私页:49） | 「不记 IP」部分成立：board.js 全部日志语句（:56、:100-110、:586、:607、:710、:726-737）均未记录 IP 或请求头原文。但「**仅**包含错误类型、上游状态码与耗时」与代码不符：该枚举只对应 `logUpstreamError` 一处（board.js:97-115）；此外还有 `sfs_shadow`（:56，记 Sec-Fetch-Site 分类）、`board_kv_read`（:586，记错误码与层）、`CLOCK_SKEW`（:607，记抓取/服务时刻）、`dual_compare`（:710、:726，记覆盖数与价差中位）等事件，均不含个人数据、但不在隐私页的日志枚举内 | ❌ **不一致／待办 T-2**（枚举不完整，非「记了不该记的」）：后续批次二选一——把隐私页该句改为概括口径（如「仅包含错误类型、状态码、耗时与链路比对等运行指标，不含访客 IP 与身份信息」）或补全枚举；本包不改文案 |
| P-18 | 不把榜单请求数据用于画像，不出售或共享给任何第三方（隐私页:49） | 仓库内无数据导出/共享/画像代码；board.js 对外只返回榜单 JSON，对内日志见 P-17。属政策声明，代码无反证；但「不出售/不共享」是持续行为承诺，单次代码快照无法证明未来 | ◐ 基本一致（政策声明＋仓库内无反证；持续性靠流程约束，不可由本表担保） |
| P-19 | 本站自身不设置任何 Cookie，这是不弹 Cookie 横幅的原因（隐私页:54） | 前端与函数范围检索 `document.cookie` / `Set-Cookie` 零命中；`public/_headers` 无 Cookie 相关头；本站两页脚本（内联＋beacon 注入形态）中，本站自有代码不写 Cookie。注：WA beacon 是否设 Cookie 属 P-08 平台口径，本行只断言「本站自身代码」 | ✅ 一致（仓库可验，限本站代码范围） |
| P-20 | 自选使用 localStorage，键名以实际上线版本为准、预定 `top200.watchlist.v1`；只存本机、不上传服务器；清站点数据可删；未使用该功能时不写入该键（隐私页:56） | 键名已坐实：`public/index.html:459` `WATCH_KEY = "top200.watchlist.v1"`，与预定值相同；读写在 :460-481（`loadWatch`/`saveWatch`），全仓无把 watchSet 上传的请求。**但有三处对不齐**：①隐私页源码 :55 仍留着「[待 W2-06 前端包落地后复核]……预写」HTML 注释——自选早已上线，该注释与「以实际上线代码为准复核后去掉本注释」的自注要求均已过期，属源码层未收尾（访客不可见，但对照时必须如实记）；②「未使用时不写入该键」对自选键本身成立，但 `loadWatch` 在每次 init 时会写后即删一个瞬时探测键 `__top200_probe__`（`public/index.html:463-464`），隐私页未提及该探测键——它不含用户数据、写入即删除，但严格按文案「无本地存储（WA 语境之外）」的读者预期应披露或改探测方式；③隐私页措辞仍是「若您使用／预定为」的预写口径，与功能已上线多时的事实不符 | ❌ **不一致／待办 T-3**：后续批次应把第五节改写为已上线口径（键名写死为实际值、删过期注释、补探测键一句或改造探测方式），本包不改文案/代码 |
| P-21 | 不收集姓名/邮箱/手机号等身份信息，无注册无登录；无广告、无第三方营销追踪，明确不用 Google Analytics 类带 Cookie 的统计工具；不做浏览器指纹识别；不出售或共享个人数据（隐私页:61-65） | 身份/注册/广告/GA 部分仓库可验：全仓检索 `google-analytics`/`googletagmanager`/`gtag` 零命中；无表单收集（CSP `form-action 'none'`）；唯一第三方脚本为 WA beacon（P-05）。「不做指纹识别」中本站自有代码部分成立（内联脚本无指纹采集），WA beacon 部分与 P-08 同为平台口径 | ✅ 一致（仓库可验；其中 WA 指纹一项交叉引用 P-08 的平台口径保留） |
| P-22 | 屏蔽方法：拦截器屏蔽 `cloudflareinsights.com` 或全局拦截第三方脚本即可不被计入；屏蔽后榜单、自选等全部功能照常可用（隐私页:71） | 代码依赖关系可验：本站功能代码（渲染/自选/取数）不引用 beacon 的任何全局变量或加载状态（内联脚本全文无 beacon 引用），beacon 为页尾独立外置脚本，其被拦截不构成 JS 依赖断裂。实际拦截效果（各拦截器规则命中 `cloudflareinsights.com` 的具体行为）须浏览器侧实测，不在本仓库证据内 | ◐ 基本一致（依赖关系仓库可验；拦截实效待浏览器侧补验，与真机清单的 WA RUM 补验同批处理，见 `ops/verification-tracker.md`） |
| P-23 | 变更规则：文案变更时更新页首日期并在更新日志留痕；涉及数据流变化先更新本页再上线功能；日后引入 Cookie 必须先改本页再上线（隐私页:76） | 有一次正例可验：WA 启用全程顺序为签收→改隐私页状态句与日期→切 CSP→部署（`ops/signoffs.md:12`、`CHANGELOG.md` 2026-11-11 条目），与本条流程相符。但本条是对未来的流程承诺，其持续执行无法由单一快照证明；且 P-20 注释过期说明「变更后复核隐私页源码细节」这一环曾漏执行 | ◐ 流程承诺（有正例、持续性不可验；以本表维护规则作为后续抓手） |
| P-24 | 第八节设「联系方式」并称站长指定邮箱后填入（隐私页:78，原文为「（站长指定邮箱待填入）」） | 隐私页 :77 源码注释自明「未指定前不显示邮箱」；截至基准提交，联系方式仍为占位句，访客实际上无任何渠道可联系站长行使隐私相关询问。仓库内其它文件亦无本站对外联系邮箱的定版记录（不在本表抄录任何个人邮箱） | ❌ **未完成／待办 T-4**：这不是文案与代码不一致，而是承诺项本身悬空。须站长指定是否公开联系渠道及具体值后，才可填入并销项；助手不得自创或从其它语境挪用邮箱填入 |

## CSP WA-ON 变体放行清单（实现侧事实，单列备查）

来源：`public/_headers`（生成物）与 `ops/headers/gen-headers.mjs`（生成逻辑），
当前变体为 WA-ON（`public/_headers:2`）。

| 指令 | WA-OFF 基线 | WA-ON 增量放行 | 证据 |
|---|---|---|---|
| `script-src` | `'self'` ＋ 首页内联 script/style 块的 sha256 hash（由 gen-headers 按块计算） | 追加 `https://static.cloudflareinsights.com`（beacon 脚本域） | `gen-headers.mjs`：`scriptSrc` 拼装处（`variant === "on"` 分支）；`public/_headers` CSP 行 |
| `connect-src` | `'self'` | 追加 `https://cloudflareinsights.com`（beacon 回传域） | `gen-headers.mjs`：`connectSrc` 拼装处；`public/_headers` CSP 行 |
| 其余指令 | `default-src 'none'`、`style-src 'self'`＋hash、`img-src 'self' data:`、`font-src 'self'`、`base-uri/form-action/frame-ancestors/object-src/worker-src` 等 | WA-ON **不**放宽任何其它指令（无 `unsafe-inline` 于 script/style 本体；`style-src-attr 'unsafe-inline'` 为 W2-18 既有过渡例外、与 WA 无关） | `public/_headers` 全文逐行核对 |

注：隐私页自身（`public/privacy/index.html`）的内联 `<style>` 不在上述 hash
计算范围内——gen-headers 只读 `public/index.html` 算 hash；隐私页样式/CSP
的既有问题属 F4-14 等其它发现的范围，本表只登记这一事实、不展开。

## 待办清单（只登记，后续批次处理，本包不动文案/代码）

| 待办 | 对应项 | 内容 | 建议处理方 |
|---|---|---|---|
| T-1 | P-04 | 总览「只有两条数据流」与第五节「数据流三」计数矛盾，改文案口径 | 后续文档批次，站长确认表述后改隐私页并同步更新页首日期 |
| T-2 | P-17 | 日志枚举不完整（漏 sfs_shadow / board_kv_read / CLOCK_SKEW / dual_compare 四类运行事件），改概括口径或补全 | 后续文档批次 |
| T-3 | P-20 | 第五节预写口径收尾：键名写死实际值、删 :55 过期注释、探测键 `__top200_probe__` 披露或改造 | 后续文档＋前端批次（改探测方式属代码变更，须另行排期） |
| T-4 | P-24 | 联系方式悬空：须站长指定公开联系渠道后填入 | 站长决策项，助手不得代填 |
| T-5 | P-06～P-10、P-12、P-15 | 平台口径复核触发点：①每季度人工核对一次 Cloudflare WA 官方文档（字段/留存/仪表盘口径有无变化）并在本表留复核日期；②G3 切 KV 路径或 WA 配置变更时，立即复核 P-15 与全部 WA 行 | 协调者按季度执行，记录追加在本表文末 |
| T-6 | P-13 附注 | 可选文案澄清：详情/页脚的 CoinGecko 网页外链是访客主动点击导航，与「浏览器不直连 CoinGecko（指行情接口）」区分 | 后续文档批次，可与 T-1 合并处理 |

## 复核记录

| 日期 | 复核人 | 范围 | 结论 |
|---|---|---|---|
| 2026-11-13 | 第四期 W4-21 执行者（文档批次） | 首建：P-01～P-24 全项，基准提交 `b552973` | 24 项：✅10／◐4／⚠6／❌4（T-1～T-4 待办登记） |
