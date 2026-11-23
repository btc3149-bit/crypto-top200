# legacy 实测计量核查与激活记录（W5，2026-11-23）

## 核查结论：未覆盖（激活前）

基线 dd16d8c 逐文件核查，无任何 legacy/dual 实际回源次数的实测计数机制：

- `functions/api/board.js`（基线）：`BOARD_KV` 只有 get——:602-604 读 `KV_KEYS.current`、:640-643 读 `KV_KEYS.health`；全文件无 `BOARD_KV.put`、无计数键。
- `scripts/quota-check.py`（基线）：legacy 侧只有建模场景 `LEGACY_SCENARIOS`（:52，0/576/1152）；:252 的 empiricalGuard 注明「legacy 侧实测计数（board.js 回源计数键）属待站长复核的约定突破项，未激活前本核账以场景估算代行」。第六期 F6-07 修的是判级口径（kv 模式 legacy 按 0 建模），是建模、不是实测计量。

## 激活（本批施工）

- 计数键：`v1:meta:legacy-credits`（`KV_KEYS.legacyCredits`，沿用 prep/w402-w406-w415 分支 W4-02 设计），结构 `{month:"YYYY-MM"(UTC), credits, updatedAt}`，跨月重置。
- 触发点：`functions/api/board.js` 的 `fetchUpstreamInternal` 在 key 已配置、请求发出前调用 `addLegacyCredits(env, 2)`（markets 1 + global 1）；缓存命中、熔断短路、kv 模式均不触发——现行生产为 kv 模式，计数应恒为 0/无键。计数失败不影响主流程；不改 `/api/board` 响应结构（只新增内部 KV 计数键）。
- 约定突破注明：此举突破「Function 只 get」旧约定（`tests/kv-write-guard.test.mjs` 已改为逐点核准这唯一例外）；**用户已于 2026-11-23 通过批准本项授权**。
- 核账呈现：`scripts/quota-check.py` 读该键并在记录中新增 `legacyMeasured` 字段，与建模 scenarios 并列标注；判级仍按 F6-07 的 G3 口径，实测值不回填已用、不改变 verdict。
- 状态：代码已施工并有测试（`tests/legacy-credits.test.mjs` 5 例、`tests/quota_check_test.py` 新增第 ⑥ 例）。**【F7-48 修订，2026-11-23】本条原写「尚未部署」为施工落盘时点口径，现已过时：计数已随 W5 Pages 部署 `eba9cb0d` 上线生效（见 `CONSTRUCTION_PHASE5.md`），部署后 quota-check 已实测读到 `legacyMeasured`（现行 kv 形态下无回源、available=false 属预期）。上文「核查结论：未覆盖（激活前）」一节为激活前的历史核查记录，保留原文备查，不得按现行状态引用。**
