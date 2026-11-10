# Changelog

本项目每次生产部署记一行：日期、版本/摘要、部署 ID。数据变更细节另见 `CHANGELOG-补位.md` 与 Git tag。

## 2026-11-10 — 基线

- **首次上线（拖放部署，快照模式故障态）**：经 Cloudflare 控制台拖放直传上线至项目 `crypto-top200`（自定义域 https://top200.oppcal.com ）。该方式不编译 `functions/`，`/api/board` 返回首页 HTML 而非 JSON，站点自上线起处于快照模式（数据基准 2026-11-08）——故障态如实记录，根因见 `UPGRADE_PLAN.md` §4.1.1。
- **数据 v2026.11.10**：剔除原表 B 43 个锚定类并顺延补入 43 个非锚定币，全表定版 182 个币全部可预估（详见 `CHANGELOG-补位.md`）。
- **P0 施工中（施工中，完成后补部署 ID）**：
  - 部署管线升级：Wrangler 直推 + 受限 API Token，`scripts/deploy.sh`（数据一致性门禁 → 预览/生产部署 → 冒烟）就绪；
  - 项目名定版 `crypto-top200`（`wrangler.toml` 已修正），拖放产物 `dist-upload/`、`upload.zip` 已移入项目外归档；
  - 冒烟断言固化（`scripts/smoke.sh`，P0-2）与本地探针就绪（`scripts/probe.sh`，P0-3，真实外部探针服务待站长提供告警邮箱后接入）；
  - `package.json` 锁定 wrangler 4.159.0；Git 初始化并打基线 tag `baseline-20261110`；
  - README 全量改写（拖放法整节标注已废弃）。
