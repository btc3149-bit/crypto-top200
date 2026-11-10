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
| W2-01 | ⏳ 施工中 | KV `BOARD_KV` 已建（ad1b7270…） | 灰度观察期（G1 72h / G3 7d）为日历时间，本报告按实际完成阶段记录 |
| W2-02 | ⏳ 待 W2-01 骨架 | | 与 W2-01 同文件串行 |
| W2-03 | ⏳ 能力建设中（默认关闭） | | PAPRIKA_ENABLED=false 硬约束 |
| W2-04 | ⏳ 前端列车批 3 | | 04a 先行 |
| W2-05 | ⏳ 前端列车批 3 | | |
| W2-06 | ⏳ 前端列车批 3 | | |
| W2-07 | ⏳ 前端列车批 3 | | |
| W2-08 | ⏳ 基线采集中 | | 阶段二~六随列车批 3-② |
| W2-09 | ⏳ 前端列车批 3 | | 语义部分先行、视觉分层随后 |
| W2-10 | ⏳ 治理链施工中 | | |
| W2-11 | ⏳ 待 W2-10/W2-12 | | |
| W2-12 | ⏳ 待 W2-10 | | 只交付脚本，不建任何定时任务 |
| W2-13 | ✅ 本体完成、U3 已接入并演练（待部署+用户注册外部账号） | health.js 桩测 6/6 PASS；hc_ping.sh 未设 URL 时 no-op 实测；commit `12b1fe8` tag `v1.5.0-probe-health`；**2026-11-10 U3 邮箱已提供**：PROBE_ALERT_EMAIL 与两家平台告警联系人统一指向该邮箱，signoffs U3 已销项、降级行已关闭；触发演练两跑（生产 pass / 故障模拟 fail，alert 通道均 armed，留痕 ops/probe-log.jsonl 18:34 CST 两行） | 外部账号（UptimeRobot/healthchecks）注册仍须用户本人用该邮箱完成（约 10 分钟，指引在 probe-config.md），注册后回填监控 ID 并补 M3 keyword 实测演练；hc_ping 的 deploy.sh 尾部钩子待协调者接；health.js 随主部署上线 |
| W2-14 | ✅ 隐私页草稿完成 | 与 board.js 实码逐项核对（缓存 120s/不记 IP 等）；commit `d2a2356` tag `v1.5.1-privacy-draft` | WA 启用门禁 U7 未签收 → 不启用；signoffs.md 已建（U3/U4/U7 pending） |
| W2-15 | ✅ 留痕体系完成 | ops/README、复核模板 R1–R7、季度表 Q1–Q10、checklists.md；commit `461e3af` tag `v1.5.3-ops-docs` | Q4 回滚演练/Q5 tail 演练待协调者在全部部署后执行回填；README 运维节替换文本已备（checklists.md 全文） |
| W2-16 | ✅ 资产完成（head 合入待前端列车后） | favicon.svg 1,279B / ico 三尺寸 / apple-touch 180×180 / og-cover.jpg 1200×630 74,589B（120×63 缩略可辨）；commit `f510eb8` tag `v1.5.2-seo-assets` | head 定版片段存 ops/seo-head-snippet.html，协调者统一合入 |
| W2-17 | ⏳ 待 W2-11 | | 回链 U4 未确认 → 整段不渲染 |
| W2-18 | ⏳ 待前端定版 | | CSP 与 WA-OFF 变体同发 |
| W2-19 | ⏳ SFS 影子随 board 窗口 | | 限流规则按方案须 W2-01 上线后校准，本期不启用 |
| W2-20 | ✅ 剧本/台账完成 | key-ledger.md（K1/K2/K2p 元数据）、rotation-playbook.md 全文；commit `461e3af` tag `v1.5.3-ops-docs`；§20.4 双落点已由协调者建立（见批 0 表） | **K2 轮换由主对话协调，本施工线未动任何 Secret** |
| W2-21 | ✅ 首期自查完成 | ops/compliance-log/2026-Q4.md：A/B1/C1/D/E1/E3/F1 通过；违禁词违规语境命中 0；commit `461e3af` tag `v1.5.3-ops-docs` | 不通过：B2（署名非数据驱动，随 W2-02 文案映射整改）、G2-K2（已暴露，轮换由主对话协调）；C2/E2 待前端落地后协调者收尾复跑；/ops/* 线上为 200 首页回退（Pages 行为，实质隔离成立，已留痕接受） |

## 阻塞与待用户事项

- U3 告警邮箱：**已提供并接入（2026-11-10）**，触发演练完成、降级解除（见 W2-13 行）；仅剩外部两家服务账号由用户本人注册这一步。
- U7 隐私文案签收：未过目 → Web Analytics 不启用（W2-14 只交隐私页草稿与剧本）。
- U4 报告回链 URL：未确认 → W2-17 回链整段不渲染。
- U8 备源启用确认：未确认 → W2-03 默认关闭。
- R1：已实测排除（见批 0 核查）。

## 部署记录

（逐次追加：时间 / 内容 / 预览 ID / 生产 ID / smoke 结果）
