# 外部探针配置清单（W2-13）

> 站点：https://top200.oppcal.com ｜ Cloudflare Pages 项目：`crypto-top200`
> 组合：UptimeRobot Free（可用性 + keyword）＋ healthchecks.io Free（dead man's switch），$0。
> **红线：本文件只记监控名称、ID、对象与断言原文；ping URL 等同密钥，禁止写入本文件或仓库任何位置，只存保险箱与调度器 secrets。**
> 状态（2026-11-10 更新）：`/api/health` 端点与本文配置规格已就绪；**U3 告警邮箱已提供（2026-11-10），降级运行已解除**（见文末「U3 降级运行声明（已解除）」与触发演练记录）。两家服务的**账号注册仍须用户本人完成**（见文末指引），注册时告警联系人统一填 U3 邮箱，注册后把监控 ID 回填本表。

## 断言原文来源（与 scripts/probe.sh 逐字对齐，禁止凭记忆改写）

`scripts/probe.sh` 现行断言（施工当日抄录）：

1. `/api/board` 返回 200 且 Content-Type 含 `application/json`；
2. `/api/board` body 可解析为 JSON 且含 keys：`coins`、`updatedAt`、`coverage`；
3. 负向断言：body 不含 `<!DOCTYPE html`（probe.sh 以 `grep -qi '<!DOCTYPE html'` 大小写不敏感匹配）；
4. 覆盖率：`coverage.returned` ≥ 期望数（`/data/coins.json` 的 coins 长度）的 **94%**；
5. 首页返回 200 且含 `市值前 200 币种`；
6. `/data/coins.json` 返回 200 且 JSON 可解析；
7. 新鲜度：`updatedAt` 距今 **≤15 分钟（900 秒）** 为 pass；`mode=stale` 且 `staleAgeSec ≤3600` 为 warn；`mode=snapshot` 为 fail。

外部探针的 keyword 只能做**字符串存在性**判断，算不了时间差——新鲜度因此不靠 keyword，改走 `/api/health` 的状态码语义（M4）与 HC1 的定时全量探针。

## UptimeRobot 监控（M1–M4，间隔均为 5 分钟，免费档下限）

| ID | 类型 | 对象 | 配置（断言定版） | 失败语义 |
|---|---|---|---|---|
| M1 首页存活 | HTTP | `GET https://top200.oppcal.com/` | 期望状态码 200 | 站点/部署整体不可用 |
| M2 接口正向断言 | Keyword | `GET https://top200.oppcal.com/api/board` | Keyword = `"mode":"live"`；Alert when: **Keyword Not Exists** | 函数在但返回降级/空数据/结构变更（200 但内容坏） |
| M3 接口负向断言 | Keyword | `GET https://top200.oppcal.com/api/board`（与 M2 独立监控：免费档单监控只能绑 1 个 keyword） | Keyword = `<!DOCTYPE`；Alert when: **Keyword Exists** | 函数异常时回吐 HTML 错误页而非 JSON（状态码可能仍是 200，只有负向断言能抓住） |
| M4 新鲜度 | HTTP | `GET https://top200.oppcal.com/api/health` | 期望状态码 200，非 200 即告警 | 数据陈旧或覆盖不全（判定逻辑在 health.js 内：age ≤900s 且 coverage 200/200 才返回 200，否则 503） |

### 落地状态（2026-11-12 更新）

- **账号**：云浏览器注册被 Cloudflare Turnstile 风控拦截（代办与用户接管均证伪），最终由用户本人在自有浏览器注册成功（2026-11-12，邮箱 kwl134999@gmail.com，免费档）；Main API Key 已存入保险箱自定义连接 `custom.uptimerobot`，监控全部经 API 建立与维护。
- **告警联系人**：id `9028550`（kwl134999@gmail.com），M1–M4 均已挂载。
- **监控 ID**：M1 `804645009`（注册流程自带的 HTTP 监控收编改名并补挂联系人）、M2 `804645065`、M3 `804645066`、M4 `804645067`，间隔均为 300 秒；2026-11-12 16:36 复核四者状态均为 UP。
- **M4 的 HEAD 坑（已修）**：UptimeRobot 的 HTTP 监控默认以 HEAD 探测，`/api/health` 原只实现 GET、对 HEAD 返回 405，M4 一度误报 DOWN 并发出真实告警。已给 `functions/api/health.js` 增加 HEAD 支持（与 GET 同状态同头、无 body）并重新部署，M4 随即恢复 UP；此间的 DOWN/UP 邮件为该误报与恢复通知，非网站故障。
- **端到端演练（已做）**：2026-11-12 临时建 keyword 监控 `804645068`（首页 + `<!DOCTYPE`、Exists 即告警），约 2 分钟内转 DOWN（status 9），证明检测与告警投递链路触发，隨即删除；测试告警邮件投递至 kwl134999@gmail.com（收件箱由用户目视确认）。M3 本体口径与该演练同构（keyword + Exists），视为已实测。

### keyword 定版说明（来源与局限，勿删）

- **M2 的 `"mode":"live"` 来源**：probe.sh 正向断言的语义是「200 + JSON + keys 齐 + coverage ≥94%」，其中可被 keyword 存在性检查等价表达的核心标记，是 `functions/api/board.js` 以 `JSON.stringify` 序列化输出的字段片段 `"mode":"live"`（无空格，与线上响应体逐字一致）。**局限**：① keyword 查不了 keys 齐全与 coverage 数值，那部分由 HC1 每小时跑 probe.sh 全量断言兜底；② `mode:"live"` 也可能来自 120 秒缓存内的响应，新鲜度精细判定归 M4/HC1，M2 只负责「接口活着且处于 live 形态」。
- **M3 的 `<!DOCTYPE` 来源**：与 probe.sh/smoke.sh 的负向断言同源（probe.sh 原文匹配串为 `<!DOCTYPE html`，大小写不敏感）。UptimeRobot keyword 定版取较短的 `<!DOCTYPE` 以覆盖各种 HTML 错误页变体；注意 UptimeRobot 的 keyword 匹配大小写行为以其控制台当日说明为准，演练 2（见 PHASE2_PLAN W2-13 验收）须实测触发一次。
- M1 的首页标题断言（probe.sh 第 5 条 `市值前 200 币种`）在 UptimeRobot 侧由 M1 的 200 状态 + W2-17 静态注入后的内容检查在 HC1 全量探针中覆盖，不另建 keyword 监控（免费档监控数虽够，但避免断言重复维护）。

## healthchecks.io 检查（HC1–HC4，免费 Hobbyist 档）

| ID | Check | 周期/宽限 | Ping 方式 | 缺席/失败语义 |
|---|---|---|---|---|
| HC1 定时全量探针 | 每 1 小时 | period 1h、grace 15 分钟 | 定时调度跑 `scripts/probe.sh` 全量断言（含新鲜度时间差判定），成功 ping success URL、任一断言失败 ping `/fail` 并附前 10 行日志。**F6-23：probe.sh 退出码三档——pass=0、fail=1、warn=4；warn（退出 4，数据陈旧降级）须与 fail 一样 ping `/fail`（附降级注记），编排须按退出码 4 分流，不得把 warn 报成 success**（编排 cron 本体由协调人集成时同步更新） | probe 调度挂了（缺席）与断言真失败（/fail 立即告警）都能报，补上 keyword 算不了的新鲜度 |
| HC2 部署后检查 | 事件型 | 不用周期缺席判定：创建后设超长 period（如 90 天）仅作占位，只用显式信号 | 部署管线尾部经 `scripts/hc_ping.sh success\|fail` ping（URL 只从部署环境变量 `HEALTHCHECKS_DEPLOY_PING_URL` 读，接入钩子由协调者串进 `scripts/deploy.sh`：冒烟通过 → success，冒烟失败 → fail；变量未设置时脚本打印 `skipped-no-url` 并以 0 退出，不阻断部署） | 部署后检查真失败时立即告警；「部署了但没跑检查」靠管线强制串联冒烟+ping 防堵，不靠缺席判定 |
| HC3 2026-11-21 复核守夜 | 一次性 cron 型 | cron 表达式 `0 9 21 11 *`、时区 **Asia/Shanghai**、grace 6 小时 | 复核任务（`ops/reviews/2026-11-21-review.md` 清单）执行完成并留痕后 ping success；若当天取消复核，须手动 ping 或删除该 check 并留痕 | 到期未复核 → 当日下午即告警；复核完成后删除/停用 HC3，不得自行滚动生成下一个复核点 |
| HC4 fetcher 影子链新鲜度（W4-03，2026-11-13 新增） | 每 1 小时 | period 1h、grace 20 分钟 | 每小时只读检查 `scripts/check-shadow-health.py`：读 KV `v1:meta:health`，lastSuccessAt ≤25 分钟且 consecutiveFailures ≤2 → ping success；否则 ping `/fail` 附日志；检查本身读不到 KV（退出码 2）同样 ping `/fail` | fetcher 假死断档 >2 个 run 即经 /fail 告警（不再等结算人工发现，补 F4-03 的最长约 73h 盲窗）；报到 cron 自身缺席则 period+grace 到期缺席告警 |

### 落地状态（2026-11-12 更新）

- **账号与钥匙**：账号已注册（kwl134999@gmail.com，免费档）；HC1–HC3 三个检查的参数与上表逐项核对一致。完整访问 API key 已轮换一次（旧 key 撤销、新 key 经用户从弹窗复制）并存入保险箱自定义连接 `custom.healthchecks`；ping URL 仍按红线只由助手程序在运行时经 API 现查现用，不落盘、不入仓库。
- **HC1 已接线**：手动首 ping 已转 UP；每小时报到由 cron `top200-hc1-hourly-probe` 承担（跑 probe.sh 全量断言，pass → success ping，fail → fail ping 附日志，并向用户汇总）。2026-11-12 已做 /fail 触发演练：HC1 实测 down → success 恢复 up，告警与恢复邮件由 healthchecks 投递至 kwl134999@gmail.com（收件箱由用户目视确认）。
- **HC2 已接线**：部署管线的 env 变量路径保留给外部部署环境；助手本人执行的部署改走等价路径——部署冒烟通过后用连接器助手脚本按检查名 ping（`hc_api.py ping HC2-top200-deploy success`），2026-11-12 已为当日 health.js 修复部署补发 success ping 并转 UP。
- **HC3 已接线**：一次性复核任务 `crypto-bottom-window-review`（2026-11-21 09:17）的交付步骤已追加"复核消息发出后 ping HC3 success"，避免到期未报到误告警。
- **HC4 已接线（2026-11-13，W4-03）**：经 API 创建检查 `HC4-top200-fetcher-shadow`（period 1h、grace 20m、邮件通道已挂），手动首 ping 已转 UP；每小时报到由 cron `top200-hc4-shadow-probe` 承担（只读 KV，全程不写 KV、不触发抓取、零 CoinGecko 额度）。影子链异常不影响当前 legacy 线上路径，但直接关系 G1/G2 证据完整性。

## 告警收敛（两家平台同口径）

- 联系人只设 1 个：**kwl134999@gmail.com**（U3 邮箱，2026-11-10 用户提供；UptimeRobot 与 healthchecks.io 两边各设同一地址为唯一告警联系人，本地探针以环境变量 `PROBE_ALERT_EMAIL` 同值接入）；不启 SMS/语音。
- 两边均开启恢复（UP/recovery）通知；无恢复邮件的 DOWN 视为未闭环。
- 部署窗口防误报：部署前 pause M1–M4、部署 + probe 通过后 resume（写进 `ops/checklists.md` 部署后清单）；不用「忽略告警」代替。
- 同根因合并：同一时间窗多条告警以 M4/HC1 为主线，只向用户转达一条汇总（见 `ops/checklists.md` 告警转达清单）。

## 告警分级与静默期（W4-18，2026-11-13 补记）

> 工作包：W4-18（P1，第四期）「告警投递第二通道 + 误报治理」之文档部分；对应发现 F4-20（投递单点）、F4-28（误报治理）。
> 本节只定口径与留痕，不改任何平台配置；下述「未挂载 / 不能落地」各项均为如实状态，不得按已生效表述。

### 分级口径（现有 M1–M4 / HC1–HC3 的归属）

判据：是否影响用户当下所见的数据与可用性，以及是否需要站长在小时级内介入。

| 级别 | 归属 | 处置口径 |
|---|---|---|
| **P0 立即处理** | M1 DOWN（站点不可用）；M2 触发（`/api/board` 非 live 形态）；M4 DOWN（`/api/health` 非 200：数据陈旧或覆盖不全）；HC1 `/fail` 或缺席超宽限（全量断言真失败或探针调度假死） | 任一监控单独成立即按 P0；向站长转达一条汇总（与文首「告警收敛」同口径），并按 `ops/checklists.md` 告警转达清单与 `docs/fetcher-runbook.md` 对应故障节处置 |
| **P1 日报汇总** | M3 单次触发后自行恢复（接口吐 HTML 多为部署瞬间或边缘抖动，持续触发则升 P0）；任一监控的单周期 DOWN 后在下一周期自恢复；全部 UP / recovery 恢复通知；HC2 部署后检查的异常（部署冒烟本身另有管线门禁，HC2 为第二道留痕）；HC3 的到期提醒类通知（流程守夜，非故障） | 不逐条打扰站长：攒入当日汇总一次转达；同一监控 24 小时内反复抖动 ≥3 次时升 P0 并查根因，不得无限期按抖动处理 |

补充判据：同一时间窗内 M4 与 HC1 同时告警（典型同根因：数据链断裂）只按一条 P0 转达，不叠加计数；判定主线以 M4 / HC1 为准（与「告警收敛」节一致）。

### 静默期（同根因 1 小时内只报一次）

目标：同一根因在 1 小时内只向站长报一次，避免邮件轰炸训练使用者忽略告警（F4-28）。

**两家免费平台能落地的部分：**

- 两家的告警模型都是「状态翻转才发信」：DOWN 发一次、恢复发一次，持续 DOWN 期间不按探测周期重复发信。因此「同一事件只报一次」在单个监控内天然近似成立，本节分级与汇总口径即是对这一形态的成文确认，无需额外设置。
- 部署窗口静默沿用既有定版：部署前 pause M1–M4、部署 + probe 通过后 resume（见「告警收敛」节与 `ops/checklists.md`），这是当前唯一主动静默手段。

**不能落地的部分（如实记录）：**

- **跨平台同根因去重无平台功能**：M4（UptimeRobot）与 HC1（healthchecks）对同一根因会各发一封，免费档均无跨服务合并 / 静默窗口设置；现行靠人工一侧执行——助手转达时按上文判据合并为一条，平台原始邮件仍是两封，此缺口靠流程而非配置弥补。
- **抖动翻转（flapping）无抑制设置**：监控在 1 小时内反复 UP/DOWN 时，两家免费档均无 flap 抑制或最小告警间隔设置，每次翻转都会发信；处置只能靠上文「反复抖动升 P0 查根因」的人工判据，不能靠平台静默。
- 因此「同根因 1 小时只报一次」是**转达层口径**（对站长只报一次），不是平台层保证；向站长汇报告警治理状态时须按此口径表述，不得宣称平台已实现静默期。

### 第二告警邮箱（邮箱已定，挂载待控制台一步，2026-11-13 更新）

- 背景：现行告警只投递一个邮箱（见「告警收敛」节），该邮箱异常即全站告警失声（F4-20）。
- 预留挂载位置：①UptimeRobot 侧新增第二个 Alert Contact 并挂到 M1–M4；②healthchecks 侧在账号通知设置中增加第二个投递邮箱 / 集成；③本地探针的 `PROBE_ALERT_EMAIL` 届时改为双收件人口径并回填本节。
- **邮箱已定：`769530631@qq.com`（站长 2026-11-13 指定）。**
- **助手 API 实测结论（2026-11-13）：两家都建不了，只能控制台建。** ①UptimeRobot：`newAlertContact` 经现行 v2 Main API Key 调用两次均返回 **HTTP 410 Gone**（回读确认未创建；v2 文档仍列该方法，但对此账号已不可用），联系人创建须走网页控制台；②healthchecks：`POST /api/v3/channels/` 返回 **405 Method Not Allowed**（回读确认未创建），channels 端点在 API v3 为只读，邮箱集成只能在网页端添加。两家创建后都需在该 QQ 邮箱内点各自的验证链接才生效投递。
- **待站长控制台一步（可与 W4-15 控制台会话同场做）**：①UptimeRobot 登录 → Alert Contacts → New Alert Contact → Type 选 E-mail、名称填 `top200-second-alert`、邮箱填 `769530631@qq.com` → 保存；②healthchecks.io 登录 → Integrations → Email → 填 `769530631@qq.com` → Add Integration；③到 QQ 邮箱点开两家各自的验证邮件并确认。完成后告知助手，助手随即经 API 把 UR 联系人挂到 M1–M4、把 HC 新通道挂到 HC1–HC3 并回读复核，再做主邮箱失效模拟验收后回填本节，F4-20 方可销项。
- 本地探针 ③ 项同步说明：`PROBE_ALERT_EMAIL` 只用于探针结果的 alert 标注（probe.sh 不直发邮件），待平台侧双通道生效后由助手把其口径改注为双收件人并回填；平台侧未生效前不改，避免标注与实际投递不符。
- **当前状态：部分完成——邮箱已定、两家创建路径已实测并转控制台一步；未挂载、不得按双通道表述。**

## 用户注册指引（须用户本人操作，约 10 分钟）

> 为什么必须本人注册：账号所有权、密码与服务条款同意只能由账号持有人完成；agent 代注册会造成账号归属与告警错投风险，也违反两家服务的账号规范。agent 只做陪跑指导与注册后的配置核对。

### UptimeRobot Free（约 5 分钟）

需要：一只能收验证邮件的邮箱（建议即日后作告警的邮箱）＋自设密码；**无需银行卡**。

1. 打开 uptimerobot.com，点 Get Started Free / Sign Up（约 1 分钟）。
2. 填邮箱与密码，提交后去邮箱点验证链接（约 2 分钟）。
3. 登录后先不建监控，把账号邮箱告知 agent，由 agent 给出 M1–M4 逐项填写清单陪跑创建（约 2 分钟/个，可与 agent 同步完成）。
4. 在 Settings / Alert Contacts 确认告警联系人邮箱无误，并开启恢复通知。

### healthchecks.io Hobbyist（约 3–5 分钟）

需要：同一邮箱即可；**无需银行卡**。

1. 打开 healthchecks.io，点 Sign Up，填邮箱（约 1 分钟）。
2. 它以邮件链接方式登录/验证，按邮件指引完成（约 2 分钟）。
3. 登录后由 agent 给出 HC1–HC3 逐项清单陪跑创建（period/grace/cron/时区照本文件表格填）。
4. 每个 check 的 ping URL **只复制到保险箱/部署环境变量**，不要发到聊天、不要截图外传（截图存档时打码）。

注册完成后：把两边各监控的 ID（不是 ping URL）回填本文件表格旁注，并在 `ops/signoffs.md` 销项降级运行行。

## U3 降级运行声明（已于 2026-11-10 解除）

- 降级期形态（历史记录）：U3 未提供期间，探针本体（M1–M4、HC1–HC3 配置规格与 `/api/health` 端点）照常先建；告警联系人悬空，「告警」实际等于平台仪表盘/状态页可见性，夜间故障可能无人收信、无时效保证。该残余风险曾记于 `ops/signoffs.md`「W2-13 降级运行中」一行。
- **解除记录（2026-11-10）**：U3 邮箱已提供并完成接入——本地探针 `PROBE_ALERT_EMAIL` 指向该邮箱；两家平台告警联系人口径定版为同一邮箱（账号注册时填写，见上「告警收敛」）。`ops/signoffs.md` 中 U3 行已销项为 signed、降级行已关闭。
- **触发演练（2026-11-10 18:34 CST，协调者执行）**：以 `PROBE_ALERT_EMAIL` 已设置状态跑 `scripts/probe.sh` 两轮——①对生产站：七项断言全 pass、verdict=pass、alert 通道 armed（`alert: would-email`）、退出码 0；②故障模拟（指向返回 HTML 的目标，模拟接口被 HTML 冒充）：七项全 fail、verdict=fail、退出码 1、alert 通道同样 armed。两轮结果均已追加 `ops/probe-log.jsonl`。说明：probe.sh 的告警语义为「would-email」（本地脚本只标注不直发邮件），真实邮件投递由两家平台在账号注册并建好监控后承担；注册后的 M3 keyword 实测触发演练待账号就绪时按 W2-13 验收补做。
