- 2026-11-13：站长待办处置轮——W4-20 Zone 处置经站长授权裁决 **A（收编）** 并上线（部署 `8dff02de`）：定位 ACAO 通配为 Pages 平台静态层默认行为，`_headers` 显式声明 `Access-Control-Allow-Origin: https://top200.oppcal.com` 替换通配（preview 先行实测单条替换、生产四路径复测一致），Observatory 收编前后均 135/A+；同轮另行处置 W4-14（K3 已轮换）、W4-18（第二邮箱已定、两家 API 建不了联系人、转控制台一步）、W4-19/W4-27（实验室验证收口）、W4-11（推荐已批准、本地准备完成、待 GitHub 一步），逐项见 CONSTRUCTION_PHASE4.md「站长待办处置轮」。
- 2026-11-13：第四期批 3/批 4 推进轮完成并上线（**v2.1.1-phase4-batch3**，部署 75a71b9a）：W4-13 CSP 生成扩至全站 HTML（隐私页样式恢复，F4-14 修复；smoke-headers 新增 S6、S2 改子集断言）、W4-19 首屏「数据截至」行与口径摘要折叠块（render 按逐币 dataDate 派生）、W4-08 之 F4-07 详情市值字段修复（marketCapUsd→mcapUsd）随同批上线；W4-10 deploy.sh 第四份副本名单门禁 + build.py --emit 字段级 validate、W4-17 工具链预检与部署后自动 probe 同步生效；W4-03 影子链监控 HC4 接线生效（每小时只读 KV 报到）；W4-09 周检修复、W4-05 契约测试、W4-16 前端 DOM 回归、W4-12 回滚脚本与 preview 演练、W4-21/W4-24/W4-25/W4-27 文档定版、W4-23 干净性能基线（LCP 中位 1.71s/CLS 0/TTFB 129ms）均已落地；W4-02/04/06/15 与 W4-08 门禁部分代码就绪于 prep 分支待 G1 结算放行，W4-11/18/20 的站长待办项已逐项登记。逐包记录见 CONSTRUCTION_PHASE4.md。
- 2026-11-13：第四期施工启动（方案 PHASE4_REVIEW.md，站长拍板 27 包全做）——本轮完成批 0 三包（W4-14 密钥台账补全至 6 类、K2 轮换状态销项；W4-22 四本账台账与触发线 runbook 新建；W4-26 runbook 三类故障处置+单一值班手册+周检加 REPORT_URL 外链检查）与 fetcher 代码准备（W4-01 global 重抓键修复、W4-10 的 KV prev 版本化、W4-16 的 fetcher 分支补测 21 条，仓库测试 40→61 条全绿）；**本轮无生产部署**，fetcher 修复代码就绪未部署、待 2026-11-14 G1 结算放行，线上仍为 v2.0.0-phase3-ui、探针 7/7。逐包记录见 CONSTRUCTION_PHASE4.md，批 0 存档 tag v2.1.0-phase4-batch0。
- 2026-11-12：第三期 UI 全面优化施工完成并上线（v2.0.0-phase3-ui，终版部署 869d5437）：25 个工作包完成 23 个（W3-22 未达、W3-25 暂缓，见 CONSTRUCTION_PHASE3.md）——容器加宽至 1500 与 12 列定宽、排名+币种冻结列与横滚提示、回链对比度达标、首次实时到达原地修补保 200 行与阅读位置、移动端五列+详情补三字段、下标零计数价格与三位有效数字市值、颜色语义收敛、无障碍补强、首页 SWR 缓存头（preview 先行验证）；全批冒烟/探针/HC2 报到全过，W2-17 的 50 行降级预案经 W3-23 实测裁决正式废弃。
- 2026-11-11：W2-01 抓取链 G1 影子观察启动——freeidx-api 按站长决定只保留每日 03:01 的 cron（删另两条），fetcher 每 10 分钟 cron 注册成功，08:20 首轮抓取成功、首次影子比对 pass。
- 2026-11-11：W2-14 Web Analytics 启用——U7 经站长签收（ops/signoffs.md）；统计站点经 API 创建（手动注入 beacon 于首页与隐私页），隐私页状态句改「已启用」并更新日期，CSP 切 WA-ON 变体（deploy.sh --check 同步），生产冒烟与 smoke-headers（variant=on）全过。备注：控制台开关路线因 Cloudflare 登录侧拦截（Turnstile/Google 回调）未能走通，改走 API + 手动 beacon 路线达成同一启用状态。
# Changelog

本项目每次生产部署记一行：日期、版本/摘要、部署 ID。数据变更细节另见 `CHANGELOG-补位.md` 与 Git tag。

- **2026-11-10 — meta v2（v1.3.0-meta-v2，本地施工，部署由协调者统一执行）**：单一事实源定版（`data/coins.json` 为唯一可编辑源、`public/data/coins.json` 为构建产物）；meta 升 v2（schemaVersion/generatedAt UTC/dataHash/sourceReports 逐份 sha256/generator/counts 全计算）；新增 `scripts/check_meta.py` 复验与 `scripts/migrate_meta_v2.py` 一次性迁移（coins 数组 dataHash 迁移前后一致）；`deploy.sh` 门禁改为只验哈希+check_meta、不一致即中止（保留 `DEPLOY_SKIP_META_CHECK=1` 留痕通道）；三场景演练留档 `ops/deploy-gate-drill-2026-11-10.log`。

## 2026-11-10 — 基线

- **首次上线（拖放部署，快照模式故障态）**：经 Cloudflare 控制台拖放直传上线至项目 `crypto-top200`（自定义域 https://top200.oppcal.com ）。该方式不编译 `functions/`，`/api/board` 返回首页 HTML 而非 JSON，站点自上线起处于快照模式（数据基准 2026-11-08）——故障态如实记录，根因见 `UPGRADE_PLAN.md` §4.1.1。
- **数据 v2026.11.10**：剔除原表 B 43 个锚定类并顺延补入 43 个非锚定币，全表定版 182 个币全部可预估（详见 `CHANGELOG-补位.md`）。
- **P0 施工完成（2026-11-10 17:19–17:29 CST）**：
  - 部署管线升级：Wrangler 直推 + 受限 API Token，`scripts/deploy.sh`（数据一致性门禁 → 预览/生产部署 → 冒烟）就绪；
  - 项目名定版 `crypto-top200`（`wrangler.toml` 已修正），拖放产物 `dist-upload/`、`upload.zip` 已移入项目外归档；
  - 冒烟断言固化（`scripts/smoke.sh`，P0-2）与本地探针就绪（`scripts/probe.sh`，P0-3，真实外部探针服务待站长提供告警邮箱后接入）；
  - `package.json` 锁定 wrangler 4.159.0；Git 初始化并打基线 tag `baseline-20261110`；
  - README 全量改写（拖放法整节标注已废弃）。
  - **生产部署 ID `d43eb23f-a50b-4c0b-81ee-acde211a74aa`**（预览 `28099b90…`、`cf2e2c19…`）：Functions 已编译生效，`/api/board` 恢复 JSON 契约（新版 board.js：allSettled 解耦、覆盖率门禁、6h stale 上限、429 熔断、错误收敛）；回滚演练完成（退回旧部署 `70a735d5…` 验证后恢复）。
  - **遗留（U2）**：CoinGecko 对 Cloudflare 出口 IP 的匿名调用返回 403/429（tail 日志实证），实时数据恢复待站长提供 CoinGecko Demo key 后以 Secret 注入并重新部署即可转 live；当前线上为新版代码 + 诚实标注的快照模式。
- **2026-11-12 — U4 研究报告回链上线**：用户确认公开分享的周期报告页链接后，填入 `scripts/pipeline_config.py` 的 REPORT_URL（唯一控制点）、重跑 render-snapshot 渲染两处回链落点、按 WA-ON 变体重新生成 `_headers` 并生产部署，冒烟 6/6；线上首页回链实测在位，HC2 部署报到已 ping（success）。同日另有 health.js HEAD 支持修复部署（见 ops/probe-config.md M4 落地状态）。
