# 第五期增补包 W5 六项施工记录（2026-11-23）

用户 2026-11-23 拍板六项全做。组织：三路并行 worktree 施工（基线 dd16d8c），协调人统一合并、部署、验收。
合并链：798502e（A 路）→ bd4d361（C 路）→ 5c9b6ed（B 路）→ 6e13d20（合并后 _headers 再生）。
部署：Fetcher Version `3ac7da31-0936-42ec-a599-f7d7c4b9b2c2`；Pages production `eba9cb0d-a389-4cd4-bde7-bfa5cdfe80bb`（经带测试门禁的 deploy.sh，冒烟+probe 全 pass）；HC2 已报 success。**无回滚、无生产事故。**

启动前核查：git 干净（dd16d8c）、/api/health ok（200/200）、/api/board 200、额度判级 OK 口径。

---

## ① SRI 处置 —— 定版：正式接受现状，security-baseline §5.4 销项

- 全站盘点：外部脚本仅 1 支——Cloudflare Web Analytics beacon（`static.cloudflareinsights.com/beacon.min.js`），在 `public/index.html` 与 `public/privacy/index.html` 各 1 处手动嵌入。无其他外链脚本；内联脚本/JSON-LD 由 CSP sha256 hash 放行，不属 SRI 范围。
- **未加 SRI，证据（非笼统跳过）**：① Cloudflare 官方 FAQ 明确手动嵌入方式「没有安全施加 integrity 的办法」：beacon 不支持 version-pinning，官方保留以同一无版本 URL 持续换版发布；只有自动注入方式由 CF 边缘对版本化 URL 自动加 integrity。② 实测口径（2026-11-23）：该 URL ETag `W/"2026.10.1"`、Last-Modified 2026-10-15、max-age=86400，内容按版本在同 URL 整体更换；当日两次间隔抓取一致（31,853 字节）仅证明当前版本内稳定——CF 一发新版，预置 hash 即失效、浏览器拒绝执行、统计静默中断。
- 残余风险接受理由（托管方即站点自身 CDN、信任边界重合、CSP script-src 已按主机收窄）、三条再评估触发条件与变更纪律已写入 `ops/security/security-baseline.md` §5.4。
- Observatory：SRI 项维持 −5、总分维持基线登记 **135/A+**。本次部署后复测**未完成**：Observatory 公开 API v2 端点已下线（返回 404），另一调用路径需用户批准、未获批准未执行。本批未触碰任何 Observatory 评分输入（beacon 标签字节未变、CSP script 口径未变，仅 style hash 随 CSS 更新），分数无变化的依据是输入不变，非实测。WA 上报：beacon 标签未作任何修改，上报连续性由构造保证；B 路本地无头 Chrome 实测 beacon 请求正常发出并完成。

## ② 第四期三个回炉项 —— 全部完成

- **W4-22 台账数字**（ops/quota-ledger.md，各处留痕 2026-11-23 修订+依据）：(a) KV 写按 dd16d8c fetcher 逐 put 点点数——成功 run 4 写（prev/blob/sourceState/health）×144 run = **576/天（57.6%，未进 70% 注意区）**，旧「544–744」作废；失败 run 2 写、跳过 run 1 写。(b) 探针最坏按 G3 形态重算：**现行生产最坏 = 0 credits/天**（kv 路径不回源）；576/1,152 仅 legacy 回退形态成立，**绝对最坏 1,152** 保留并注明形态前提。(c) M4 表述已改：health.js 内嵌 fetch /api/board，legacy 下可间接驱动回源、kv 下不回源。月度复核表补记 2026-11-23 W5 专项复核行（Functions/部署两账待月度抄录，未编数）。
  - ⚠️ **重要发现**：第五期 W5-12 声称的「sourceState 变化才写」在 dd16d8c 代码中**并不存在**（写点仍每 run 无条件执行）——KV 写优化实际从未落地，已在台账如实注明；若日后落地，KV 写可降至约 432/天。本批不扩围，建议后续独立立项。
- **W4-23 性能基线补跑**（ops/perf-baseline.md 新增节）：PSI 仍 429 口径下用本机 Lighthouse 13.6.0 + chrome-headless-shell 按自家口径跑满——生产 5 跑 LCP 逐跑 2002/2137/1981/1919/1854 ms（中位 **1981**）、CLS **5 跑全 0（无越线跑）**、TTFB 中位 215 ms；对照 3 跑 LCP 中位 1829、CLS 全 0、TTFB 中位 177。TTFB 为经本地转发代理的实验室值，前提已在文件中注明。
- **W4-12 文档同步**：模式回滚定版口径（部署时 [vars] 注入 BOARD_READ_MODE 后跑 deploy.sh；API 改项目级 env 不被直推携带、rollback.sh mode 子命令单独不作数）已同步三处——docs/fetcher-runbook.md 开头摘要、README.md 回滚方法段（新增模式回滚段）、ops/oncall-handbook.md §4。

## ③ 命中域 + aria-controls —— 完成

- **根因（真 bug）**：≤640 档 `.exp{min-width:44px}` 规则写在基础 `.exp` 规则之前，同特异性被后写的 28px 覆盖，长期失效——修复前真浏览器 computed min-width 全宽度恒为 28px。
- **定版**：桌面视觉盒保持 28×28，`.exp::after` 每边外扩 8px → 有效命中 **44×44**（不改列宽/行高）；≤640 规则移至基础规则之后定版（本体 44×44、`::after` 收回 inset:0）；粗指针 ≥641 档同理收回。
- **六宽度真浏览器实测**（无头 Chrome + CDP，360/390/640/768/1024/1500）全过：命中跨度 44×44；行高与修复前逐档一致（手机 76.7px、桌面 50.9px，**零布局变化**）；页面级横向溢出 0、列宽错配 0、0 宽单元格 0、视觉重叠 0；展开详情完整。部署后线上 HTML 已抽查含 `.exp::after` 规则。
- **aria-controls 200/200**：快照静态行、JS 模板行、patchInPlace 修补后三条路径均全量配对 `aria-controls='d-<id>'`，toggleExpand 的 aria-expanded 同步与收起保留经实测。新增 DOM 测试 3 个（aria 三路不回归、命中域定版+级联顺序回归、SRI 处置守卫），frontend-dom 19/19。

## ④ legacy 实测计量 —— 核查未覆盖 → 已激活

- **核查结论：未覆盖**。证据（基线 dd16d8c）：functions/api/board.js 中 BOARD_KV 只有 get（current/health 两处），无任何 put/计数键；scripts/quota-check.py 只有建模场景 LEGACY_SCENARIOS 且自注计数键「未激活…以场景估算代行」。第六期 F6-07 修的是建模判级，不是实测计量。
- **已激活**（沿用 W4-02 prep 设计）：计数键 **`v1:meta:legacy-credits`**（`{month, credits, updatedAt}`，跨月重置）；board.js 在 `fetchUpstreamInternal` 真正回源前 +2（markets+global），kv 模式/缓存命中/熔断不触发；**不改 /api/board 响应契约**。quota-check.py 读入并以 `legacyMeasured` 与建模场景并列呈现（判级仍按 G3 口径）。kv-write-guard 改为逐点核准这唯一例外（其余 put/delete 仍判失败）。wrangler.toml 注释、代码注释与 ops/legacy-measured-counter-w5.md 均注明：此举突破「Function 只 get」旧约定，用户已于 2026-11-23 批准本项授权。
- 部署后实测：quota-check verdict=**OK**，legacyMeasured `available=false`——kv 模式恒不回源、计数键尚未创建，属预期；一旦回退 legacy/dual 形态即开始实测计数。

## ⑤ 说明项 —— 无施工

W5-01~W5-12 其余条目不在本批范围，未顺手扩围。

## ⑥ Paprika 映射落库 —— 落库完成，门禁不放水，Paprika 保持关闭

- **落点定版**：事实源 = `workers/fetcher/src/coins-list.js` 的 COINS（`{id, paprikaId}` 标准形，与 F5-01 口径一致；fetcher 门禁计数直接消费此表，避免双源漂移）；`scripts/build.py` 以 `load_paprika_map()` 从事实源透传，不另立映射表。提案 200 条逐条校验：id 与 COINS 全对上、无重复、196 非空全部格式合法，无静默丢弃。详细记录见 docs/paprika-mapping-landing-2026-11-23.md。
- **字段规范**：FIELDS24 = FIELDS23 + `paprikaId`（末尾追加）；check_meta / index.html decodeCoinsData / board.js getIds 三处解码均按 meta.fields 动态解码（逻辑零改动仅补注释），契约测试新增用例证明 FIELDS23 旧形态仍可解码；dataHash 口径 A 不变，因规范对象新增一列，哈希由 `264c2b20…` 变为 `73a22ff0…`（内容新增列的预期变化）。
- **实测数字**（2026-11-23）：
  - coins.json paprikaId 非空 **196/200**（三份同字节；部署后线上 /data/coins.json 实测同为 196，meta.fields 末位为 paprikaId）。
  - tickers 命中 **178/200**（单次 GET `/v1/tickers?quotes=USD&limit=5000`，实回 2000 条上限，按 paprikaId 匹配；独立复跑同得 178；第六期基线 179）。未命中 22 = 未映射 4 + 已映射 18：其中 17 个已映射币在 Paprika 活跃但自家 rank 3683–6944、超出 tickers 前 2000 批量列表（抽查单币端点均有报价）；1 个已下线（yzy，is_active=false）。
  - 未映射 4 币全部留空、不猜填（候选证据见落库记录）：hash-2（候选均已停用）、celium（全量表无对应条目）、genius-3（名/symbol 双对上者已停用，活跃者非全等）、nxm（仅 Wrapped NXM，非同一资产）。
- **门禁结论**：`PAPRIKA_MIN_MAPPED=197` 与 verify 门槛（195）一字未改，备源开关默认值未动。差距：映射差 **1**（196<197）、tickers 命中差 **17**（178<195）→ **Paprika 保持关闭**。部署后 fetcher 首个新代码 run（20261123T0200Z-869a）实测 KV health `paprikaMappedCount=196`、consecutiveFailures=0——落库已被生产计数消费，门禁仍强制 CoinGecko，属预期。

---

## 测试总账

合并后主干 `./scripts/run-tests.sh`：**15/15 套件全部通过**（board、board-v2、board-fetcher、fetcher-branches、frontend-dom 19 例、contract-real-data、snapshot-verify、health、kv-write-guard、legacy-credits 5 例、coins-list-contract、compare-shadow、render、weekly、quota_check 6 例）。各分支施工期亦全绿（C 路 169 项、B 路 frontend-dom 19/19、A 路 15/15）。

## 部署后验证（全部实测，2026-11-23 02:00 UTC 前后）

- /api/health ok、coverage 200/200；/api/board 契约 v2、coverage 200/200、missingIds 空、stale=false。
- KV health（0200Z run）：consecutiveFailures=0、paprikaMappedCount=196、lastRunId 20261123T0200Z-869a。
- quota-check：verdict=OK，legacyMeasured 并列呈现（available=false 属预期）。
- compare-shadow（F6-08 新口径）：mode=same-source、verdict=conditional、compared=200、价差中位 0——kv 形态下的正确标注，非故障。
- UptimeRobot M1–M4 全部 up（status=2）。
- 线上 index.html 抽查：`.exp::after` 命中域规则在位；WA beacon 标签在位且字节未变（无 integrity 属性，与 ① 定版一致）。
- Observatory 复测未完成（见 ①），基线 135/A+ 维持登记。
