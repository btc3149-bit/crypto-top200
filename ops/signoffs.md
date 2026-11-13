# 用户签收记录（signoffs）

> 用途：记录需要用户本人确认/提供的事项（U 系列）的签收行，是部署门禁的审计依据。
> 表头规范（每行必填）：`日期 | 事项编号 | 事项 | 文案/对象版本或文件哈希 | 结论 | 备注`。
> 状态取值：`pending`（待签收）/ `signed`（已签收）/ `degraded`（降级运行中）。
> 红线：本文件只记事项与版本/哈希，禁止写入任何密钥、ping URL、token 值或邮箱以外的个人信息；邮箱如需记录只记「已提供」事实，地址本体存保险箱。

| 日期 | 事项编号 | 事项 | 文案/对象版本或文件哈希 | 结论/状态 | 备注 |
|---|---|---|---|---|---|
| 2026-11-10 | U3 | 告警邮箱提供（W2-13 探针告警主通道） | — | signed | 邮箱已提供（地址本体按红线不入本文件，存保险箱/连接器）；投递配置与触发演练已于当日完成（见 `ops/probe-config.md` 与 `CONSTRUCTION_PHASE2.md` 演练记录），本行销项。外部两家服务账号仍须用户本人注册，注册时告警联系人即填该邮箱 |
| 2026-11-12 | U4 | 研究报告回链 URL 确认（W2-17 回链落点） | — | signed | 用户已确认其公开分享的周期报告页链接（muse.ai 公开分享地址，地址本体见 scripts/pipeline_config.py 的 REPORT_URL）；已填入 REPORT_URL 一处、重跑 render-snapshot、重新生成 _headers（WA-ON）并部署上线，线上首页两落点回链实测在位；HC2 部署报到已 ping。本行销项 |
| 2026-11-11 | U7 | 隐私说明文案签收（W2-14，《隐私说明》全文过目并同意启用统计） | `public/privacy/index.html` 草稿（2026-11-10 版）sha256 `977ce2f2a430a2fd87888e93fc165bc417cd5eb468975f8f0890392068e652ad` | signed | 用户于 2026-11-11 在主聊天明确回复「同意启用统计」；按既定顺序执行：签收 → 开 Pages 项目级 Metrics 开关 → 隐私页状态句改「已启用」并更新页首日期 → CSP 切 WA-ON 变体 → 重新部署 |
| 2026-11-10 | W2-13 | 外部探针降级运行（U3 未提供期间） | `ops/probe-config.md`（W2-13 配置规格） | signed | 降级期：2026-11-10 当日。**已销项（2026-11-10）**：U3 邮箱落地后已补投递配置（PROBE_ALERT_EMAIL 与两家平台告警联系人口径）并完成触发演练（正常 pass + 故障 fail 两跑，alert 通道均为 armed，留痕 ops/probe-log.jsonl），降级解除 |
| 2026-11-12 | U-UR | UptimeRobot 注册落地（W2-13 外部监控其一） | — | signed | 云浏览器注册被 Turnstile 风控拦截（代办与用户接管均证伪）后，用户本人在自有浏览器注册成功；Main API Key 存保险箱连接 custom.uptimerobot；M1–M4 经 API 建成并复核全 UP（ID 见 ops/probe-config.md 落地状态）；临时监控端到端触发演练通过 |
| 2026-11-12 | U-HC | healthchecks.io 注册与接线落地（W2-13 外部监控其二） | — | signed | 账号与 HC1–HC3 已建并逐项核对；完整访问 API key 已轮换（旧 key 撤销）并经保险箱连接 custom.healthchecks 存入；HC1 每小时报到 cron（top200-hc1-hourly-probe）已建、HC2 部署报到已通、HC3 已挂入 11-21 复核任务；/fail 触发演练实测 down→up 闭环通过 |
| 2026-11-13 | W4-12 | 回滚演练计时（rollback.sh，preview 演练） | `ops/disaster-recovery/rollback-drill-2026-11-13.md` | signed | preview 实测：rollback API 对 preview 被平台拒绝（8000040，仅限 production）；preview 等效恢复=重部署上一版内容 15.5s（含冒烟）；mode 路径 PATCH 设置+回读 2.4s，演练后已恢复 preview env 为空。production 实弹回滚未演练（纪律禁动生产），留 G3 窗口补记；可演练路径耗时远低于 ≤15 分钟目标 |
