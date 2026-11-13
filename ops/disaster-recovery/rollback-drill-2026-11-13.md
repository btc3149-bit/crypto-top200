# 回滚演练记录（W4-12）— 2026-11-13

> 演练对象：`scripts/rollback.sh`（deployment / mode 两条路径）。纪律：只动 preview，production 零写操作。
> 施工方先行实测（脚本头注释留痕）+ 协调者同日复现，二者结论一致。

## 结论摘要

| 路径 | 结论 | 实测耗时 |
|---|---|---|
| deployment（rollback API） | **preview 被平台拒绝**：错误码 8000040「You cannot rollback to a preview deployment. You can only rollback to past production deployments.」——API 只接受 production 部署 | 调用往返约 1.6s（拒绝即返回） |
| deployment（preview 等效恢复） | 平台拒绝后的等效手段 = 把上一版内容重新部署到 preview：以 tag `v2.0.0-phase3-ui` 内容部署 preview 并验证旧内容在位，再部署回当前版并验证新标记在位 | 旧版部署 15.5s（含冒烟）；恢复当前版 19.0s（含冒烟） |
| deployment（production 本体） | 未实弹演练（纪律禁动生产）。脚本已对生产部署列表做 dry-run 验证：正确选出当前/上一个部署、防误触退出码 3、目标打印无误。生产回滚的真实执行留待 G3 切换窗口按 runbook 操作并补计时 | dry-run 约 1.3s |
| mode（改 BOARD_READ_MODE） | preview 实测通过：PATCH 单 key 合并语义（不回传 secret 值）、回读核对通过、原有 key 全保留；演练后已删除该 key，preview env 恢复为空（与配置清单一致） | 设置+回读约 2.4s |

**总评**：可演练路径的机器耗时均在 1 分钟内，远低于 ≤15 分钟目标（含人工决策时间仍充裕）。G3 模式回滚的真实形态 = `rollback.sh mode legacy --env production`（改 env）+ 一次 `deploy.sh production`（新部署生效），两步均有现成工具；注意改 env 不热切换当前在线部署，此口径已写入脚本注释与值班手册。

## 演练步骤与证据（协调者复现，2026-11-13）

1. `bash scripts/rollback.sh deployment --env preview`（dry-run）：正确列出 preview 当前部署 `e13b5c33…` 与上一个 `cb1ff624…`（2026-11-13T02:55:48Z），未带 ROLLBACK_CONFIRM 时以退出码 3 拒绝执行。
2. `ROLLBACK_CONFIRM=1 bash scripts/rollback.sh deployment --env preview`：API 返回 8000040 拒绝（原文如上表），脚本正确识别平台限制并给出等效恢复指引，本次未对 preview 做任何变更。
3. `bash scripts/rollback.sh mode legacy --env preview`：PATCH success → 回读 BOARD_READ_MODE=legacy、原有 key 全保留（当时 preview env 为空集）。随后协调者以 PATCH 置 null 删除该 key，回读 env_vars={} 已恢复。
4. 等效恢复：`git worktree` 取 `v2.0.0-phase3-ui` → `deploy.sh preview`（15.5s，冒烟全过）→ curl 核验 preview 首页无 `dataAsof` 标记（旧内容在位）；再从 master `deploy.sh preview`（19.0s）→ 核验标记回归（计数 1）。

## 残留事项

- production 的 rollback API 实弹回滚未演练（纪律所限）：G3 切换当日如需回滚，先 dry-run 核对目标部署 id，再带 ROLLBACK_CONFIRM=1 执行并在此文件补记实际耗时。
- 回读存在数十秒级传播延迟（施工方实测），脚本已内置最多 6 次重试回读。
