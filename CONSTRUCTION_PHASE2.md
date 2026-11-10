# 第二期施工进度报告 · crypto-top200（top200.oppcal.com）

- 施工依据：`PHASE2_PLAN.md`（21 个工作包 W2-01~W2-21）
- 协调者：二期施工协调 agent ｜ 开工：2026-11-10
- 基线（开工实查）：线上 mode=live、coverage 200/200、smoke 6/6 PASS、git HEAD `1f7484a`（tag `v1.2.0-refill200`）

## 批 0 核查结果（2026-11-10）

| 项 | 结果 |
|---|---|
| 线上基线 | `/api/board` mode=live、200/200、global 非空；smoke 六断言全 PASS |
| W2-01 权限核查（R1） | **未触发**：受限 Token 实测可读 KV namespace 列表与 Workers 脚本列表，且成功创建 `BOARD_KV`（id `ad1b72702c5c4f229999bea5b118d1bc`）。权限口径与连接文档记载（仅 Pages Edit）不符，以实测为准；Worker 部署权限在 G0 部署时终验 |
| board.js markets 调用形态 | 单次调用（`per_page=250` + ids 参数，board.js 现行实现），W2-01 节奏定版 10min/30min 成立，无需降频 |
| CoinGecko key 的 agent 侧通道 | custom.coingecko 凭据不对 sandbox 开放（authd 403）；构建审计/周检按方案 §1.4 从 agent 环境变量取用 key（不进仓库），沙箱匿名调用 CoinGecko 目前可用作回退 |
| W2-08 测量基线 | **PSI 不可得**：匿名配额当日耗尽（HTTP 429），按 §8.2 降级口径记「基线缺失、恢复后补测」至 `ops/perf-baseline.md`（commit `56ec8d6`），含实测替代指标（基线 index.html 19,549B/gzip 7,235B、board 16,642B）。未编造分数 |
| W2-20 §20.4 续期提醒双落点 | **已建立**（协调者直办）：①跟踪项「Cloudflare Token（Pages Edit）续期」（goal_26789285f19a，挂 goal_e8cc61a445fe 下）；②一次性任务 `cf-token-renewal-20270201`，2027-02-01 09:17 CST 触发，body 指向 rotation-playbook.md K1 节并要求以 key-ledger.md 台账为准 |

## 逐包状态

| 包 | 状态 | 验收证据 / 部署 ID | 备注 |
|---|---|---|---|
| W2-01 | ⚠️ 代码与部署完成、灰度待 key 注入启动 | fetcher 已部署（crypto-top200-fetcher，Version `a8697e3f`）——**R1 终验通过：受限 Token 可部署 Worker**；G0 安全态实证：无 token /run→404、带 token→502 config 错误（缺 key 明报、不匿名重试）、失败不覆写、health 已落 KV；shadow blob 17,950B 写读核对、compare-shadow PASS；tests fetcher/schema 8/8；commit `0faab26` tag `v1.6.0-fetcher` | **G1 起点 = 向 fetcher 注入 COINGECKO_API_KEY**：本沙箱无该凭据通道（custom.coingecko 对 sandbox 返回 403、env 无值、不得经聊天取值）。建议与主对话 K2 轮换合并执行：先轮换出新 key，再一次性注入 Pages + fetcher 两处，避免把已暴露旧 key 再写入第二存储后重做。注入后 G1 操作（删 BOARD_FETCH_DISABLED、加 triggers、BOARD_TARGET_KEY=shadow、重部署、每小时 compare-shadow，观察 ≥72h/≥400 run）见 docs/fetcher-runbook.md；G2/G3/G4 为其后的日历门禁（48h/7d），本期如实停在 G0 |
| W2-02 | ✅ 完成（激活随 G3） | board.js 三态重写；tests 合计 27/27（legacy 故障矩阵 7/7 行为等价、v2 六时刻状态机 12/12、fetcher/schema 8/8）；§18.3 安全头同出口（200/405 实测齐全，生产复核 nosniff/no-referrer 在位）；SFS 影子计数合入（见 W2-19）；commit `4bf41da` tag `v1.6.1-contract-v2`；Pages 生产已以 legacy 缺省部署运行（中间部署 5d310ca0，mode=live 正常，shared import 打包已被生产实证） | 前端四级文案映射与 global.asOf 标注、W2-03 署名三态均与 kv 激活（G3）同窗口实施——legacy 契约下现行三态文案与之匹配，提前切换会造成文案与契约错位；偏差：board.js 总 769 行（kv 路径主体约 200 行达标，legacy 平移保全），legacy 保留「缺 key 匿名尝试」与 §20.5 口径差异已登记，G4 收口 |
| W2-03 | ✅ 能力完成（启用被双重否决） | 映射核定 196/200（179 价差 accept + 17 身份 accept；未决 4：HASH/SN51/GENIUS/NXM，paprikaId=null）；gen/verify 脚本与提案存 docs/；commit `6af02c9` tag `v1.6.2-paprika-capability` | **覆盖实测第 1 天 179/200 < 195 禁用线 → 按方案门槛禁止启用**，与 U8 未确认叠加，PAPRIKA_ENABLED=false 维持、备源终点维持快照；连测第 2/3 天仅在覆盖结构变化时才有意义，建议随 U8 议题一并搁置。paprikaId 落库未执行：启用已被否决、字段当前惰性，落库需动 build.py 合并源并变更 dataHash，留待覆盖/U8 有进展时随数据更新一并做（已记为剩余项） |
| W2-19 | ⚠️ 影子计数已合入、限流未启用 | Sec-Fetch 影子随 board.js 上线（ENFORCE_SFS=false，只记结构化日志，tests 覆盖）；commit `4bf41da` | 按方案限流规则须 W2-01（kv 链路）上线后按一周实测校准——kv 未激活，校准期未开始，本期不启用为方案内结论，非延期失误 |
| W2-04 | ✅ 列车完成 | 04a：三态 †69/未核实 36 桩测一致；04b：九字段逐项核对、展开跨重绘存活；commits `d31a949`/`bd5cdfd` | 随批 3 统一部署后线上复验 |
| W2-05 | ✅ 列车完成 | 删下拉+表头排序 31 项 PASS、ALIASES 30 条双源核名逐条桩测命中；commits `c513c06`/`5cc171f` tag `v1.4.2-fe3` | |
| W2-06 | ✅ 列车完成（1 项待线上补验） | 三类坏值兜底/防抖落盘/交集语义全过；commit `60e7f45` | 「只看自选内取消收藏单行局部删除」桩内不可验，部署后由协调者浏览器冒烟补验 |
| W2-07 | ✅ 列车完成 | 五条验收全过（三种写法直达/无效 hash 无副作用/藏匿状态五步链/分页外定位/scrollLeft 复位）；commit `b835301` tag `v1.4.4-fe5` | |
| W2-08 | ⚠️ 地基完成、PSI 基线缺失 | 子批 2 硬门禁：三态逐币 diff=0 后才提交；commit `d4e7ec8` tag `v1.4.1-fe2` | PSI 匿名配额 429，基线按 §8.2 降级记录于 ops/perf-baseline.md（commit `56ec8d6`），恢复后补测 |
| W2-09 | ✅ 列车完成 | 语义：aria-live 全文恰 1 处、scope×12、focus 环；视觉：「低 · 谨慎」、倍数 ▲/▼ 分档与方案分布一致；commits `d31a949`/`5cc171f` | C2 复核项可随本次交付关闭（W2-21 收尾复跑时确认） |
| W2-10 | ✅ 完成 | check_meta 对生产数据 11/0；meta v2 迁移 dataHash 一致（264c2b20…）；deploy.sh 门禁三场景演练全过（留档 ops/deploy-gate-drill-2026-11-10.log）；commit `2fd6977` tag `v1.3.0-meta-v2` | 部署由协调者在统一部署中执行（门禁在真实管线中再验一次） |
| W2-11 | ✅ 完成（签核待协调者确认） | build.py 六阶段；金标对账 dataHash 一致、逐字段 diff=0；破坏性测试三项全拦截；干净环境复现一致；commit `5f7e05a` tag `v1.4.0-build-pipeline` | 偏差 3 项已留痕：overrides 13→14（AERO 双 id 歧义补登，有市值/排名证据）；G4 对双 None 放行；--offline 结转口径。构建报告签核行 coordinator-pending，协调者在本报告确认签核 |
| W2-12 | ✅ 完成 | overrides 落值后 check 全 pass（evidenceUrl 经 API 验活 15/15）；首跑周报 ops/weekly/2026-W46.md（告警 0/人工队列 9/watch-in 63/watch-out 32）；副本演练两项精确命中；commit `e6858b3` tag `v1.3.1-overrides-weekly` | **未建任何定时任务**（按硬约束）；C6 CoinCap 接口空响应不可用，按口径跳过并计数，已在周报注明 |
| W2-13 | ✅ 本体完成、U3 已接入并演练（待部署+用户注册外部账号） | health.js 桩测 6/6 PASS；hc_ping.sh 未设 URL 时 no-op 实测；commit `12b1fe8` tag `v1.5.0-probe-health`；**2026-11-10 U3 邮箱已提供**：PROBE_ALERT_EMAIL 与两家平台告警联系人统一指向该邮箱，signoffs U3 已销项、降级行已关闭；触发演练两跑（生产 pass / 故障模拟 fail，alert 通道均 armed，留痕 ops/probe-log.jsonl 18:34 CST 两行） | 外部账号（UptimeRobot/healthchecks）注册仍须用户本人用该邮箱完成（约 10 分钟，指引在 probe-config.md），注册后回填监控 ID 并补 M3 keyword 实测演练；hc_ping 的 deploy.sh 尾部钩子待协调者接；health.js 随主部署上线 |
| W2-14 | ✅ 隐私页草稿完成 | 与 board.js 实码逐项核对（缓存 120s/不记 IP 等）；commit `d2a2356` tag `v1.5.1-privacy-draft` | WA 启用门禁 U7 未签收 → 不启用；signoffs.md 已建（U3/U4/U7 pending） |
| W2-15 | ✅ 留痕体系完成 | ops/README、复核模板 R1–R7、季度表 Q1–Q10、checklists.md；commit `461e3af` tag `v1.5.3-ops-docs` | Q4 回滚演练/Q5 tail 演练待协调者在全部部署后执行回填；README 运维节替换文本已备（checklists.md 全文） |
| W2-16 | ✅ 资产完成（head 合入待前端列车后） | favicon.svg 1,279B / ico 三尺寸 / apple-touch 180×180 / og-cover.jpg 1200×630 74,589B（120×63 缩略可辨）；commit `f510eb8` tag `v1.5.2-seo-assets` | head 定版片段存 ops/seo-head-snippet.html，协调者统一合入 |
| W2-17 | ⏳ 待 W2-11 | | 回链 U4 未确认 → 整段不渲染 |
| W2-18 | ⏳ 待前端定版 | | CSP 与 WA-OFF 变体同发 |
| W2-20 | ✅ 剧本/台账完成 | key-ledger.md（K1/K2/K2p 元数据）、rotation-playbook.md 全文；commit `461e3af` tag `v1.5.3-ops-docs`；§20.4 双落点已由协调者建立（见批 0 表） | **K2 轮换由主对话协调，本施工线未动任何 Secret** |
| W2-21 | ✅ 首期自查完成 | ops/compliance-log/2026-Q4.md：A/B1/C1/D/E1/E3/F1 通过；违禁词违规语境命中 0；commit `461e3af` tag `v1.5.3-ops-docs` | 不通过：B2（署名非数据驱动，随 W2-02 文案映射整改）、G2-K2（已暴露，轮换由主对话协调）；C2/E2 待前端落地后协调者收尾复跑；/ops/* 线上为 200 首页回退（Pages 行为，实质隔离成立，已留痕接受） |

## 阻塞与待用户事项

- U3 告警邮箱：**已提供并接入（2026-11-10）**，触发演练完成、降级解除（见 W2-13 行）；仅剩外部两家服务账号由用户本人注册这一步。
- U7 隐私文案签收：未过目 → Web Analytics 不启用（W2-14 只交隐私页草稿与剧本）。
- U4 报告回链 URL：未确认 → W2-17 回链整段不渲染。
- U8 备源启用确认：未确认 → W2-03 默认关闭；且覆盖实测 179/200 已触禁用线，启用议题双重搁置。
- **fetcher key 注入（W2-01 的 G1 起点）待主对话执行**：本沙箱无 CoinGecko 凭据通道（vault 对 sandbox 403、env 无值、不得经聊天取值）。建议与 K2 轮换合并：轮换出新 key 后一次性执行 `npx wrangler secret put COINGECKO_API_KEY -c workers/fetcher/wrangler.toml`（值走安全流程，不经聊天/文件），随后按 docs/fetcher-runbook.md 翻 G1 开关并重部署 fetcher。MANUAL_RUN_TOKEN 已由施工方注入为 fetcher Secret（值未落任何文件/日志），后续如需使用可随时以同一命令重设。
- R1：已实测排除（见批 0 核查）。

## 部署记录

（逐次追加：时间 / 内容 / 预览 ID / 生产 ID / smoke 结果）

- **2026-11-10 18:36–18:37 CST 中间部署**（A 治理链 + B 前端列车 + C 表面运营 + D 已提交的 W2-02 legacy 态 + 协调者 W2-16 head 合入）：预览 `0bf4c530` → 生产 `5d310ca0`，两次 smoke 均 6/6。生产验收：board mode=live、age≈0s、200/200；`/api/health` 200 `ok:true`；probe 全 pass（alert armed）；§18.3 安全头已随 board 响应上线（Referrer-Policy/X-Content-Type-Options 实测在位）；favicon/og-cover/robots/sitemap/privacy 均可达。
- **观察项（预览环境）**：preview 分支未注入 COINGECKO_API_KEY（Pages 密钥按环境隔离，一期只注入了生产），预览 board 匿名抓取遭 429 熔断，呈 stale/间歇 503——属环境差异非代码回归（生产带 key 实测 live 正常）；与 W2-20 §20.3「Preview 改 fixture」的既定方向一致，本期不给预览补 key（Demo 档全账号仅 1 把 key 的约束）。
