# P0 施工报告 · 币圈前 200 预估站（crypto-top200）

- 施工日期：2026-11-10（CST 17:10–17:31）
- 依据：`UPGRADE_PLAN.md` P0 清单（P0-1 ~ P0-7）与 §7.4 第一批顺序
- 线上：https://top200.oppcal.com ｜ 备用 https://crypto-top200.pages.dev
- 生产部署 ID：`d43eb23f-a50b-4c0b-81ee-acde211a74aa`（预览：`28099b90-e61b-45f5-8019-5c2ce808dab7`、`cf2e2c19-4e72-43e9-aeeb-8b2f9272d4b6`）
- Git：基线 commit `7190dd1`（tag `baseline-20261110`）→ 施工 commit `c2b7f13`（tag `v1.1.0-p0`）

## 实际部署方式（P0-1 结论）

采用方案 (a)：**Wrangler CLI 直推 + 受限 API Token**，原地修复既有项目 `crypto-top200`，未新建项目、未动 DNS 与自定义域。

- 凭据通道：令牌存于自定义连接 `custom.cloudflare`（连接文档与助手在 `~/workspace/custom-connectors/custom.cloudflare/`，动词见其 CONNECTOR.md）。部署时仅把 authd 发放的 `hsurr:` 代用值写入 `CLOUDFLARE_API_TOKEN` 环境变量，真实令牌由出站代理在发往 `api.cloudflare.com` 时替换，全程无明文落盘/入日志。
- 部署前只读验证：经 API 列出账号 Pages 项目（9 个），确认 `crypto-top200` 可见（域名 crypto-top200.pages.dev + top200.oppcal.com，生产分支 main）；全程只触碰该项目，账号下其他 7 个域名与 18 个既有应用未动。
- 工具链：Wrangler 锁定 4.159.0（`package.json` 精确版本 + package-lock）。部署命令形态：`wrangler pages deploy public --project-name crypto-top200 --branch <preview|main>`，固化在 `scripts/deploy.sh`（先做 data/ 与 public/data/ 两份 coins.json 一致性门禁，不一致以 data/ 为准同步）。此后「换数据再部署」= 改 coins.json 后跑一次 `npm run deploy`，一步完成。

## P0 七项状态与验收证据

### P0-1 部署管线升级 + 实时行情恢复 —— 管线 ✅ 完成；实时数据 ⚠️ 差最后一环（U2）

方案 §4.1.4「实时行情恢复清单」逐条：

| # | 验收条 | 结果 | 证据 |
|---|---|---|---|
| 1 | `/api/board` 返回 JSON、含 coins 且条数与 id 数一致（182）、global 非空、updatedAt 为近期 | ❌（被上游拦截，见下） | 接口已恢复 JSON 契约：预览首测返回 `Content-Type: application/json` + 完整新契约字段（mode/coverage/snapshotDate）；但 CoinGecko 对 Cloudflare 出口 IP 的**匿名**调用返回 403（预览 tail 日志 `errorType:"http_error", upstreamStatus:403`）与 429（生产 tail 日志 `errorType:"rate_limited", upstreamStatus:429, durationMs:125`），故 coins 为空、走快照信号/503 收敛 |
| 2 | 页面徽章「实时行情」、4 项实时指标非空、价格/倍数按实时渲染 | ❌（同上） | 代码已三态就绪（见 P0-6），当前线上如实显示「快照模式（2026-11-08）」而非假实时 |
| 3 | 控制台 Functions 页不再提示无 /functions 目录 | ✅（行为等价证据） | Wrangler 部署输出 `Compiled Worker successfully` + `Uploading Functions bundle`；线上 `/api/board` 已由函数真实处理（JSON/503 均出自函数逻辑，不再是 HTML 回退） |
| 4 | 预览部署 URL 可访问且其 /api/board 同为 JSON | ✅ | https://preview.crypto-top200.pages.dev 冒烟：①②③⑤⑥ PASS（JSON、含 coins/updatedAt/coverage 键、无 DOCTYPE），仅 ④ coverage 条数因上游拦截 FAIL |
| 5 | 回滚演练：退回上一生产部署再恢复，均正常 | ✅ | API rollback → `70a735d5…`（旧拖放版）：/api/board 复现 HTML 故障态，证明回滚真实生效；再 rollback → `d43eb23f…`：接口恢复 JSON、首页为新版代码。两次 API 均返回 success 且 deployments 列表核对一致 |
| 6 | wrangler.toml / README / 线上项目名三者一致；仓库无 dist-upload/、upload.zip | ✅ | 三处均为 `crypto-top200`（README 全文 grep 旧名零残留）；两样拖放产物已移至 `~/workspace/cloudflare-top200-site-归档/`（可恢复，非删除） |

**未达项的根因与解法（不在代码侧）**：CoinGecko 匿名接口按出口 IP 限流/拦截，Cloudflare Pages 的共享出口 IP 已被其 403/429——这正是方案 S2/U2 预言的情形，本次由 tail 结构化日志实证（403 与 429 两种形态都出现过，加浏览器 UA 后由 403 转为 429，拦截依旧）。解法即 P0-4 的既定设计：用户提供 CoinGecko Demo key（U2）→ `wrangler pages secret put COINGECKO_API_KEY --project-name crypto-top200` → 跑一次 `npm run deploy`，接口即转 live（代码读取点、熔断与覆盖率门禁均已就绪并通过故障注入测试）。在此之前，站点保持**如实标注的快照模式**，不再出现旧版「无标注冒名实时」。

### P0-2 冒烟断言固化 + README 改写 —— ✅ 完成

- `scripts/smoke.sh`：六项断言（200+JSON Content-Type、body 含 coins/updatedAt/coverage、无 `<!DOCTYPE html` 负向断言、coverage ≥ 期望 94%、首页标题、coins.json 可解析），任一失败非零退出；`deploy.sh` 部署后自动调用。
- 双向验证：对旧故障线上跑出预期 FAIL（HTML 冒充被 ①②③ 精准抓住）；对健康伪造接口全 PASS；对新版预览 5/6 PASS（仅 coverage 因 U2）。
- README 全量改写：只写新部署法；拖放法整节标注「已废弃：控制台拖放不编译 functions/，会导致 /api/board 失效（2026-11-10 审计结论）」；补回滚、冒烟/探针、Secret 口径、硬红线、运维节奏；项目名不一致已消除。

### P0-3 健康探针 —— ✅ 本地部分完成；外部探针服务 ⏳ 待 U3 邮箱

- `scripts/probe.sh`：与 smoke 同组断言 + 新鲜度断言（updatedAt ≤15 分钟；stale 且 ≤3600s = WARN；snapshot = FAIL），结果逐行 JSON 追加 `ops/probe-log.jsonl`。
- 触发演练已完成两轮：对旧故障线上的真实 FAIL 行已留档（部署前）；部署后对生产再跑一行（当前 verdict=fail，失败项为 api/coverage/freshness，与 U2 拦截事实一致）——探针能如实反映状态，证明断言有效。
- 告警邮箱接入点已预留（`PROBE_ALERT_EMAIL` 环境变量，当前标注 `skipped-no-email`）。外部探针服务（UptimeRobot 等）与邮件告警待用户提供邮箱（U3）后接入。

### P0-4 额度止血（429/熔断/方法限制/错误收敛） —— ✅ 代码完成；Demo key ⏳ 待 U2

- 429：读 `Retry-After`（秒/HTTP-date 均可解析，缺失默认 60），模块级熔断期内不再打上游；无缓存时 503 + `{error:"upstream_unavailable"}` + Retry-After 头。生产实测正是此形态（503 + 收敛错误体，不含上游原文）。
- 方法限制：`onRequestGet` 承载 GET，非 GET 经 `onRequest` 兜底 405 + `Allow: GET`（单测 ⑦ 通过）。
- 错误收敛：对外只有 `{"error":"upstream_unavailable"}` / `{"error":"method_not_allowed"}` 两类；上游状态与耗时只进结构化 `console.error`（tail 实证可读），key 不入日志。
- CoinGecko Demo key：注入点就绪（`env.COINGECKO_API_KEY` → `x-cg-demo-api-key` 头，文件头注释标明 Secret 方式），当前匿名运行——但匿名已被上游拦截（见 P0-1），key 到位是转 live 的唯一剩余动作。

### P0-5 board.js 三修复 —— ✅ 完成（495 行，故障矩阵 7/7）

- `/global` 解耦：markets/global 各自 AbortController 3.5s 超时 + `Promise.allSettled`，global 失败只置 null（单测 ②）。
- 覆盖率门禁：`returned < ceil(expected × 0.94)` 判失败走回退，expected 按当次 id 数相对计算（现 182，后续 200 币自动适配）；响应带 `coverage{expected, returned, missingIds}`（单测 ③）。
- stale 硬上限：`STALE_MAX_SEC = 21600`（6h），超龄不端旧价、改回快照信号（单测 ⑥）；10 分钟龄缓存正常 serve stale 且 `staleAgeSec` 服务端算好（单测 ⑤）。
- 附带同批修复：缓存先行于 id 拉取、in-flight 合并、空 ids 判失败、缓存键去主机名、响应 Cache-Control 头组（线上实测存在）。
- 测试：`tests/board.test.mjs`（Node 24 实跑）：① live ② global reject ③ 覆盖不足 ④ 429 熔断+二次不打上游 ⑤ stale 10 分钟 ⑥ stale 7 小时转快照 ⑦ POST 405 —— 7/7 PASS。另修一处实测问题：CoinGecko 对 Workers 默认 UA 返回 403，上游请求已显式设置浏览器 UA（注释留档）。

### P0-6 状态诚实化 —— ✅ 完成

- 前端三态机（live/stale/snapshot）由 `BOARD.mode` 驱动，无 BOARD = snapshot；初始 HTML 默认即快照口径，行情确认前不闪「实时」。
- 强绑定项：徽章三态文案（实时行情 / 缓存行情（约 N 分钟前）/ 快照模式（2026-11-08））、状态横幅三态、表头四列随态切换（实时↔缓存↔快照价（11-08）等）、统计卡（snapshot 时卡 1 去「实时」字样并置灰、卡 4 改显「数据基准 · 快照 2026-11-08」；stale 时卡 4 附数据年龄，口径直读服务端 `staleAgeSec`）。
- 单币局部回退角标：live/stale 下某币不在实时数据中时，其现价后加「快照价」小字（防新旧价格同表混排无感知）。
- 验证：内联脚本 `node --check` 通过；31 项结构断言全 PASS；Node 桩 DOM 四场景演练（live/stale/snapshot/请求抛错）文案与角标均符合定版。线上首页源码实测含 statusBanner、三态文案与 staleAgeSec 逻辑。

### P0-7 移动端核心列可达 —— ✅ 完成（代码级验收）

- `@media (max-width:640px)`：隐藏 6 列（报告排名、24h、实时市值、报告现排名、ATH、核心依据，表头与行模板 `hm` class 成对各 6 个），保留核心 6 列（预估排名/币种/现价/2029 预估区间/倍数/置信度）；`table{min-width:0;width:100%}`，375px 无需横滑。
- 输入控件 ≤640px 时 `font-size:16px`（防 iOS 聚焦缩放）；工具栏控件 `min-height:44px`。桌面样式未动。
- 线上首页源码实测含上述媒体查询与 44px 规则。真机视觉验收未做（无真机通道），建议站长用手机打开 https://top200.oppcal.com 顺手核一眼。

## 线上当前状态（如实）

- 页面：新版代码已上线（182 币全表、方法论、三态诚实标注、移动端裁剪）。
- 行情：快照模式（2026-11-08 基准）——接口函数在岗、契约正确，但 CoinGecko 匿名拦截使实时数据暂不可得；页面标注与实际状态一致，无冒名实时。
- 探针最新行（2026-11-10T09:29Z）：home/data_json/api_no_html PASS，api/coverage/freshness FAIL，verdict=fail，alert=skipped-no-email —— 与上述状态吻合。

## 遗留项

1. **U2 CoinGecko Demo key（阻塞实时行情）**：用户免费申请后经安全通道提供，执行 `wrangler pages secret put COINGECKO_API_KEY --project-name crypto-top200` + `npm run deploy` + smoke 复验即可转 live。
2. **U3 告警邮箱**：提供后接入外部探针服务（UptimeRobot）三条断言 + 邮件告警，并做一次触发演练收尾 P0-3。
3. **200 币数据待并入**：数据团队交付 200 币版 coins.json 后，按新管线一步部署（改 data/coins.json → `npm run deploy`），coverage 门禁按 200 自动适配。
4. **P1 批次（未施工）**：Cron+KV 抓取架构（P1-1，与额度可持续强相关，建议紧随 U2 之后）、数据治理 meta 升级、备源、SEO/统计、Watchlist 等，见 `UPGRADE_PLAN.md` §7.2。
5. 小项：`board.js` 中 429+已超龄缓存组合时选择快照信号 200 而非 503（有缓存条目时优先给 updatedAt 信息量），与方案口径的这一处取舍已在代码与本报告留档；`global.asOf` 未加（保持既有前端消费形状）。

## 纪律核对

- 全部改动先本地完成并自测（node --check、故障矩阵 7/7、前端 31 项断言 + 桩 DOM 演练）→ 预览部署冒烟 → 生产部署 → 线上逐项验收 → 回滚演练，全程留证据如上。
- 未触碰账号下其他项目/域名/应用；DNS 与自定义域绑定未动；令牌明文未出现在任何文件、日志与本报告中。
