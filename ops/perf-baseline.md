# 性能基线 · W2-08（PHASE2_PLAN.md §8.2）

- 记录时间：2026-11-10（批 0，任何前端改造部署之前）
- 对象：https://top200.oppcal.com/（线上生产版，改造前基线）

## PSI 采样结果：不可得（如实记录）

- 采样方式：PageSpeed Insights API v5，mobile/desktop 各 3 次，performance + accessibility 两类。
- 结果：**全部失败**。唯一返回体为 HTTP 429：`Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'pagespeedonline.googleapis.com'`（匿名共享配额当日耗尽，consumer project_number:583797351490）。
- 按 §8.2 降级口径处理：**基线缺失，PSI 恢复后补测**；本文件不填任何分数，不得以任何估算值代替。

## 可复核的替代客观指标（改造前，实测）

| 指标 | 值 | 测法 |
|---|---|---|
| index.html 大小（改造前基线） | 19,549 B（gzip 后 7,235 B） | git tag `v1.2.0-refill200` 版本实测 |
| board JSON 大小 | 16,642 B（gzip 传输 5,411 B） | 2026-11-10 线上 /api/board 实测（mode=live、200/200） |
| 线上 TTFB 中位 | —（未单独采样，随 PSI 补测一并补） | — |

## 补测约定

- PSI 匿名配额恢复（次日）或取得 PSI API key 后，按 §8.2 原口径补测 mobile/desktop 各 3 次取中位，回填本文件并标注补测日期；补测结果只用于与改造后对比，不改变本期任何已施工内容。

## 补测 · W3-23（PHASE3_UI_EVAL.md P2-06，2026-11-12）

- 补测时间：2026-11-12 20:00–20:07（CST，UTC 12:00–12:07），对象同上：https://top200.oppcal.com/ 生产页。
- 工具路线（按优先级实走并留证）：
  1. **PSI API 匿名调用：仍失败**。2026-11-12 19:51（CST）实测 mobile/performance 返回 HTTP 429，错误体与 2026-11-10 完全一致：`Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'pagespeedonline.googleapis.com'`（consumer project_number:583797351490，`RESOURCE_EXHAUSTED`）。PSI 口径基线依然不可得，本节以下为本机 Lighthouse 口径，不冒充 PSI 数值。
  2. **本机 Lighthouse CLI：成功（本节采用）**。Lighthouse 13.6.0（`npx -y lighthouse`，npm 缓存，0 元）+ chrome-headless-shell 157.0.8103.78（`npx @puppeteer/browsers install chrome-headless-shell@stable`，Google 官方免费分发）。系统自带 `/opt/meta-chromium/chrome` 不能用作 Lighthouse 驱动：启动即报错 `Hatch WebGL domain policy is required for browser startup`、Lighthouse 报 `waiting for dynamic debugging port`，故弃用。WebPageTest 公共接口未试：本机路线已通，按约定优先级无需动用（其公共接口通常需 key，本项目无 key）。
  3. 测量环境说明（VM 特有，非线上代码问题）：本机出网须经带认证的上游 egress 代理，而 Chrome 的 `--proxy-server` 不支持带认证地址（实测 `ERR_NO_SUPPORTED_PROXIES`、直连 `ERR_SSL_PROTOCOL_ERROR`），故在 `/tmp` 起了一个仅监听 127.0.0.1 的无认证转发代理供 Chrome 使用（纯测量工具，未改项目任何代码）；上游 TLS 拦截 CA 不在 headless-shell 信任库内，Chrome 侧加 `--ignore-certificate-errors`（实测不加为 `ERR_CERT_AUTHORITY_INVALID`）。Lighthouse 节流为 simulated（先观测后建模，见下口径），代理对建模值的影响有限，但下列绝对值仍应读作「本 VM 环境的实验室值」，不是真实用户字段数据。
- 口径（与 W3-23 定版一致）：移动端，`formFactor=mobile`、模拟 UA `moto g power (2022)` / Android 11、屏幕模拟 412×823 @ DSF 1.75；节流 `throttlingMethod=simulate`，等效 Slow 4G：RTT 150 ms、吞吐 1,638.4 kbps（下行建模 1,474.56 / 上行 675 kbps）、CPU slowdown 4×；仅跑 performance 类别。生产组 5 次、对照组 3 次，原始 JSON 证据测量时留存于 `/tmp/w323/prod-1..5.json`、`ctrl-1..3.json`（/tmp 为临时区，数值以本节表格为准）。
- **INP：实验室不可测，如实记录**。Lighthouse 13.6.0 本批报告的 audits 中无 `interaction-to-next-paint`、亦无 `experimental-interaction-to-next-paint`（已逐份查键确认），故 INP 无实验室值，以下以 **TBT（Total Blocking Time）代作主线程参考**，不得把 TBT 当 INP 达标/不达标结论；INP 目标 ≤200 ms 只能待字段数据或带交互脚本的专项测量裁决。

### 生产组（正常加载，含 /api/board）5 次原始值与中位

| # | 时刻 (UTC) | LCP (ms) | CLS | TBT (ms) | FCP (ms) | Speed Index (ms) | TTI (ms) | Perf 分 |
|---|---|---|---|---|---|---|---|---|
| 1 | 12:00:19 | 1,986 | 0 | 119 | 1,986 | 2,554 | 2,268 | 96 |
| 2 | 12:01:24 | 2,080 | 0 | 228 | 2,080 | 2,331 | 2,459 | 93 |
| 3 | 12:02:23 | 1,652 | 0 | 172 | 1,652 | 1,745 | 2,117 | 97 |
| 4 | 12:03:22 | 1,612 | 0 | 278 | 1,612 | 1,853 | 2,131 | 93 |
| 5 | 12:04:21 | 1,989 | 0.012 | 264 | 1,989 | 2,185 | 2,520 | 92 |
| **中位** | — | **1,986（1.99 s）** | **0** | **228** | **1,986** | **2,185** | **2,268** | **93** |

- 对照 W3-23 目标（中位）：LCP ≤2.5 s ✅（1.99 s）、CLS ≤0.1 ✅（0）、INP ≤200 ms ⚠️ 不可裁（见上，TBT 参考 228 ms 不是 INP）。
- LCP 元素：两组均为首屏文本块 `body > div.wrap > div.sub`（「预估目标窗口：2029 年…」段），且每跑 LCP = FCP，即首屏文本首次绘制即 LCP，与 P2-06 推演一致。
- CLS 细节：5 跑中 4 跑为 0；第 5 跑出现单次位移 0.012，元素为 `body > div.wrap > div.stats`（统计卡区，board 数据回填实时总市值等数值时发生）。量级远低于 0.1，但定性上证明「实时回填可致位移」存在，塌缩/位移的根治仍按 W3-05 原地修补验收（见裁决）。

### 对照组（屏蔽 /api/board）3 次原始值与中位

- 方法：同口径加 Lighthouse 测量参数 `--blocked-url-patterns="*api/board*"`（仅本地运行参数，未改线上或本地任何代码）。有效性已核：对照组配置记录 `blockedUrlPatterns=['*api/board*']`，board 请求状态 -1、传输/资源均为 0 B（未加载）；生产组 board 为 200、资源 16,716 B。coins.json 在两组均正常加载，故对照组分离的是「快照自身」与「board 到达后整表替换/回填」的差异。

| # | 时刻 (UTC) | LCP (ms) | CLS | TBT (ms) | FCP (ms) | Speed Index (ms) | TTI (ms) | Perf 分 |
|---|---|---|---|---|---|---|---|---|
| 1 | 12:05:20 | 1,835 | 0 | 167 | 1,835 | 1,992 | 2,159 | 96 |
| 2 | 12:06:18 | 1,486 | 0 | 91 | 1,486 | 1,486 | 1,731 | 99 |
| 3 | 12:07:18 | 1,733 | 0 | 110 | 1,733 | 1,860 | 2,029 | 98 |
| **中位** | — | **1,733（1.73 s）** | **0** | **110** | **1,733** | **1,860** | **2,029** | **98** |

- 中位差（生产 − 对照）：LCP **+253 ms（+0.25 s）**、TBT **+118 ms**、CLS 中位无差（0 vs 0）。注意生产组 LCP 自身跑间极差为 468 ms（1,612–2,080），大于组间中位差 253 ms，故该差应读作「board 路径约有 0.25 s 量级的 LCP/TBT 成本、但未超出跑间噪声一个量级」，不能读作精密因果值。

### 重要披露：测量窗内生产页正在被第三期其它工作包连续部署

- 本批 8 跑期间生产 HTML 资源体积发生阶梯变化：生产组第 1–4 跑为 208,128 B，第 5 跑 236,626 B，对照组 237,623 B；测量后复查（12:08–12:10 UTC）线上 HTML 已为 239,515 B 并继续变为 243,765 B，CSP 脚本哈希亦随之更换。即**本节中位为跨版本混合值**。缓解事实：8 跑逐跑全部满足 LCP ≤2.5 s（最高 2,080 ms）与 CLS ≤0.1（最高 0.012），故下方裁决的方向不依赖跨版本精密比较；但**第三期全部部署冻结后，应按本节同口径再补跑一组干净基线**（生产 5 跑 + 对照 3 跑）替换本节数值口径，届时 PSI 若恢复可一并补原 §8.2 的 mobile/desktop PSI 口径。

### 对 W2-17「LCP 退化 >0.3 s 则快照降级 50 行」判据的裁决建议

- **建议：不触发、且正式废弃该降级预案，200 行快照一行不删。** 依据：①按判据自身的口径，board 路径的 LCP 中位退化为 +0.25 s，未达 0.3 s 门槛；②生产组 LCP 中位 1.99 s、CLS 中位 0，绝对值双双达标，8 跑无一跑越线；③该预案与项目硬约束「200 行不删减」冲突，而其要解决的替换塌缩/位移问题已有 W3-05 原地修补路线（按行 id 修补、不整表替换、不截断）定版承接——后续应以 W3-05 施工后按本节同口径复测（重点看 CLS 是否恒 0、TBT 中位是否下降）作为验收，不再以删行数换性能。

## 重测 · W4-23 干净基线（2026-11-13，版本冻结于 v2.1.1-phase4-batch3）

- 重测时间：2026-11-13 11:00–11:05（CST），对象：生产 https://top200.oppcal.com/ ，版本为第四期批 3 部署（deployment 75a71b9a，含 W4-13/W4-19/W4-08 修复），测量期间无部署进行（满足「干净基线」口径，回应 F4-36）。
- 工具路线：PSI API 匿名调用仍 429（同前两轮，配额耗尽），按降级口径走本机 Lighthouse：Lighthouse（npx，npm 缓存）+ chrome-headless-shell 157.0.8103.78（与 W3-23 同版本），经 127.0.0.1 无认证转发代理 + `--ignore-certificate-errors`（同 W3-23 §3 环境说明）；本轮 Chrome 启动另需 `--no-sandbox --disable-dev-shm-usage --disable-gpu`（VM 沙箱限制，与网站无关）。节流为 simulated、mobile 口径。绝对值仍属本 VM 实验室值，非真实用户字段数据。
- 结果（3 次取中位）：

| 指标 | run1 | run2 | run3 | 中位 | 对照（三期 W3-23） |
|---|---|---|---|---|---|
| LCP | 2,566 ms | 1,642 ms | 1,706 ms | **1,706 ms** | 中位 1,990 ms |
| CLS | 0.1416 | 0 | 0 | **0** | 0 |
| TTFB（server-response-time） | 108 ms | 129 ms | 167 ms | **129 ms** | 未单独采样 |
| Performance score | 58 | 79 | 84 | 79 | — |

- 说明：run1 为离群（LCP 与 CLS 同时偏高，其 layout-shift 条目无子项留痕），中位口径下 CLS=0、LCP 较三期中位改善；TTFB 本轮起纳入采样（F4-36 缺项已补）。INP 实验室仍不可测（同 W3-23 §4 口径），不以 TBT 冒充。
- 持续监测口径（W4-23 后半）：LCP/CLS/TTFB 纳入**月度人工采样**——与 W4-20 安全复测、W4-22 四本账复核同节奏执行（每月一次，按本节方法连跑 3 次取中位回填本文件），不新建自动任务；下一次采样应在 W3-22 上线后版本冻结时执行（届时另起一节）。

## 补跑 · W4-23 自家口径补跑（W5 回炉，2026-11-23）

- 补跑时间：2026-11-23 09:41–09:43（CST，UTC 01:41–01:43），对象：生产 https://top200.oppcal.com/ ，版本冻结于 dd16d8c（线上部署 33163028，第六期上线版），采样期间无部署进行。
- 为什么补跑：原 W4-23 只跑 3 次且 CLS 只报中位（掩盖一跑 0.1416 越线），未按自家口径（生产 5 跑 + 对照 3 跑）执行。本节按定版口径补满，逐跑列出、不只报中位。
- 工具路线：PSI API 匿名配额仍不可依赖，按项目先例走本机 Lighthouse 口径：Lighthouse 13.6.0（`npx -y lighthouse`）+ chrome-headless-shell 157.0.8103.78（与 W3-23/W4-23 同版本），经 127.0.0.1 无认证转发代理 + `--ignore-certificate-errors`（同 W3-23 环境说明：上游 egress 代理带认证、Chrome 不支持带认证 proxy-server，故本地转发；TLS 拦截 CA 不在 headless-shell 信任库）。节流 simulated、mobile 口径（Slow 4G 建模、CPU 4×）。绝对值仍属本 VM 实验室值：TTFB 经代理与 simulated 建模、非真实用户字段数据，读数时须带此前提。
- 原始 JSON 留存于 `/tmp/w5perf/prod-1..5.json`、`ctrl-1..3.json`（/tmp 临时区，数值以下表为准）。

### 生产组 5 跑（逐跑）

| # | 时刻 (UTC) | LCP (ms) | CLS | TTFB / server-response-time (ms) | Perf 分 |
|---|---|---|---|---|---|
| 1 | 01:41:17 | 2,002 | 0 | 292 | 74 |
| 2 | 01:41:36 | 2,137 | 0 | 244 | 73 |
| 3 | 01:41:57 | 1,981 | 0 | 215 | 76 |
| 4 | 01:42:13 | 1,919 | 0 | 155 | 73 |
| 5 | 01:42:30 | 1,854 | 0 | 192 | 77 |
| **中位** | — | **1,981（1.98 s）** | **0** | **215** | **74** |

- 越线标注：**无越线跑**——5 跑 LCP 全部 ≤2.5 s（最高 2,137 ms）、CLS 全部 = 0（无一跑重演 W4-23 那次 0.1416）。逐跑如实列出即为此结论的证据，不以中位掩盖。

### 对照组（屏蔽 /api/board）3 跑（逐跑）

- 方法同 W3-23：`--blocked-url-patterns="*api/board*"`，仅本地测量参数。

| # | 时刻 (UTC) | LCP (ms) | CLS | TTFB (ms) | Perf 分 |
|---|---|---|---|---|---|
| 1 | 01:42:46 | 1,829 | 0 | 151 | 98 |
| 2 | 01:43:06 | 1,807 | 0 | 177 | 95 |
| 3 | 01:43:25 | 2,109 | 0 | 288 | 96 |
| **中位** | — | **1,829（1.83 s）** | **0** | **177** | **96** |

- 中位差（生产 − 对照）：LCP +152 ms、TTFB +38 ms、CLS 无差（0 vs 0）；生产组 LCP 跑间极差 283 ms 大于组间中位差，差值仍只读作量级参考（同 W3-23 口径）。Perf 分差（74 vs 96）主要不在 LCP/CLS 两项，属 TBT 等其余实验室指标差异，本节不据此下结论。
- 结论：按自家口径（5+3）补跑完成，当前冻结版本 LCP 中位 1.98 s ≤2.5 s ✅、CLS 中位与逐跑均为 0 ≤0.1 ✅；INP 实验室仍不可测（同前口径，不以 TBT 冒充）。
