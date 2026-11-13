# 健康口径定版（W4-06）——单一口径源 shared/health-thresholds.json

> 状态：第四期门禁准备分支定版（只备不部署，随批 2 放行后生效）。
> 单一口径源：`shared/health-thresholds.json`。改阈值只改这一个文件，并回本文件补一行理由；
> 禁止在 health.js / smoke.sh / probe.sh 里再写死数字（读不到 JSON 时三方一律 fail-closed 取最严值）。

## 定版值

```json
{
  "coverage": { "expectedCount": 200, "passRatio": 1.0 },
  "staleSec": 900,
  "quotaCriticalStaleSec": 1800
}
```

| 常量 | 值 | 消费方 | 含义 |
|---|---|---|---|
| `coverage.expectedCount` | 200 | health.js | 名单定版条数；board 自报 expected 必须等于它，防止期望值漂移时假绿 |
| `coverage.passRatio` | 1.0 | health.js、smoke.sh、probe.sh | returned 必须 ≥ expected × 1.0，即 **returned 必须等于 expected** 才算完整 |
| `staleSec` | 900 | health.js、probe.sh | 新鲜度阈值：now − updatedAt ≤ 900s 为新鲜（与 board 新鲜度分级 L0 上限同值） |
| `quotaCriticalStaleSec` | 1800 | health.js | quotaMode=critical 时的新鲜度阈值，与 fetcher critical 抓取间隔（`shared/board-schema.js` 的 `FETCH_INTERVAL_SEC.critical`）同值联动，两处改值必须同批 |

注入方式：health.js 以 ESM JSON import 直读该 JSON（部署时 Wrangler/esbuild 内联进 Function
bundle，运行时零 IO；本地 Node 测试原生支持）；smoke.sh / probe.sh 以 `python3 -c` 读同一文件。

## 为什么这么定（F4-06 倒置问题）

改版前三方口径互相打架：

- smoke（发布门禁）容忍 94%：returned ≥ 188 即 PASS；
- health（生产监控）要求 returned == expected == 200 且 age ≤ 900s；
- probe 另有 stale WARN 一档。

结果是**门禁比监控松、监控比门禁严，方向倒置**：188 币可以全绿上线，199 币却会触发
M4 每 5 分钟告警。门禁的职责是比监控更早拦住坏数据；倒置后，部署流程亲手放行的状态
恰恰是生产告警的状态，值班者只能在上线后被每 5 分钟吵醒去处理一个「门禁说没问题」的数据面。

定版原则：**健康 pass 的定义全网唯一** —— 完整 = 200/200（returned == expected == 200），
新鲜 = age ≤ 900s（critical 例外见下）。94% 仍是 **fetcher/board 的数据发布门禁**
（`COVERAGE_RATIO`，决定「这批数据值不值得端出」，低于它走 stale/快照降级），与「健康」
不是同一概念，不合并、不互相替代：发布门禁回答「能不能给」，健康口径回答「给的是不是定版全量」。
188–199 币属于「可降级端出、但不是健康全量」，监控就应当报——前提是发布门禁也如实把它
标成不健康，而不是像旧 smoke 那样给它发绿灯。

## 两场景在新口径下的判定

| 场景 | smoke.sh（门禁） | /api/health（监控） | probe.sh |
|---|---|---|---|
| **188 币**（returned=188, expected=200） | **FAIL**：188 < 200 × 1.0，部署被门禁拦住 | **503**：complete=false | coverage **fail**，verdict=fail |
| **199 币**（returned=199, expected=200） | **FAIL**：199 < 200 × 1.0，部署被门禁拦住 | **503**：complete=false | coverage **fail**，verdict=fail |

两场景三方同判，无倒置：门禁先红（拦部署），若该状态由线上数据漂移造成而非部署，
监控同口径报红（M4/HC1 告警）——告警内容与门禁标准一致，值班者不需要翻译两套口径。
代价是口径收紧后 199 币这类「只差 1 个」也会红：这是定版选择——名单定版就是 200，
差 1 个币意味着名单/上游已漂移，正是需要人看一眼的信号；且 fetcher 发布门禁（94%）
仍保证用户侧有数据可看（stale 降级），红的是健康灯，不是页面。

## quotaMode=critical 时为何不误报

fetcher 的额度降频定版（`FETCH_INTERVAL_SEC`）：normal 每 600s 抓、saving 每 900s 抓、
**critical 每 1800s 抓且 global 停抓**。critical 是「按投影将击穿月额度」时主动拉长
间隔的自保形态，不是故障：该形态下 board.updatedAt 的年龄在下一次抓取前**正常可达
约 1800s**。若 health 固定用 900s 阈值，critical 期间每个抓取周期的后半段必然 503，
M4 每 5 分钟告警一次——把自保形态报成故障，既吵又掩盖真故障。

联动定版：health.js 从 KV 的 fetcher health 记录读 `quota.quotaMode`，critical 时
阈值取 `quotaCriticalStaleSec=1800`（与抓取间隔同值，含边界 ≤），其余形态仍 900s。
这样 critical 下 age ≤1800s 判新鲜（与 board 侧 L1 delayed 上限亦同值），超过 1800s
（即已错过一整个 critical 抓取周期）仍判 503——误报消除，真断档照样报。读不到 KV
health 记录时按 normal/900s 处理：不放宽、不假绿。

## 附：W4-08 字段级门禁口径（同批定版，源在 shared/board-schema.js）

价格 / 市值 / rank 三字段非空率（`FIELD_NONEMPTY_MIN_RATIO = 0.99`），两档：

- 任一字段 < 99% → **fail**：fetcher 拒绝写 blob 并记 health 错误；board legacy 抛错走
  stale/快照降级；KV 读路径的 validateBlob 直接判 invalid。
- 全部 ≥99% 但任一 <100% → **warn**：照常出数，但记结构化 WARN 日志且 board 响应带
  `fieldQuality` 字段。2026-11-13 实测的「200 币中 2 个 rank=null」（198/200 = 99%）
  即此档——旧门禁对此完全失明，新口径下它会留下 WARN 口径而非无声通过。
