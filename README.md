# 币圈市值前 200 预估排名站（crypto-top200）

线上地址：https://top200.oppcal.com （Cloudflare Pages 项目名定版：`crypto-top200`）

本站是研究报告《市值前 200 加密货币下一轮牛市高点预估排名》的在线版：**全表 182 个币全部可预估**（原表 B 的 43 个锚定类资产已剔除，并按市值顺延补入 43 个非锚定币，详见 `CHANGELOG-补位.md`）。数据基准：老币为 CoinGecko 口径 **2026-11-08 日收盘快照**，补位币为 **2026-11-10 CoinGecko 实盘核验**。预估窗口为 2029 年 9 月下旬 ~ 10 月中旬的历史周期情景推演区间。

页面打开后由 `functions/api/board.js` 服务端代理 CoinGecko 实时行情（缓存 120 秒），倍数空间按现价自动重算；接口不可用时页面回退到快照数据并标注「快照模式」。

> ⚠️ 本站不构成投资建议。预估是历史周期情景推演，不是预测。页面顶部已内置风险提示，请勿删除。

> 现状注记（2026-11-10）：线上当前仍是首次拖放部署的版本，处于快照模式故障态（`/api/board` 未生效，原因见下方「已废弃」一节）。按本文新法（Wrangler 直推）完成第一次重新部署后，实时行情恢复，届时删去本注记。

## 硬红线（任何改动不得触碰）

- **不删风险提示**：页首风险条与页脚免责声明必须保留（预估倍数排名 ≠ 推荐排名）。
- **零广告、零返佣、零引流**：不加广告位、不加交易所返佣/注册链接、不做社群引流；同时不得出现收费荐币、代客理财、承诺收益话术。
- **只动 `crypto-top200` 这一个项目**：部署、Secret、回滚等一切 Cloudflare 操作只针对本项目，不触碰账号下其他域名与应用。

## 包里有什么

| 文件 | 作用 |
|---|---|
| `public/index.html` | 网页本体（无需任何构建步骤） |
| `public/data/coins.json` | 预估数据（网页实际读取这一份） |
| `data/coins.json` | 预估数据主文件（与上面内容相同；两份必须一致，部署脚本会校验） |
| `functions/api/board.js` | 行情代理：服务端拉 CoinGecko 实时价格并缓存 120 秒 |
| `wrangler.toml` | Pages 项目配置（项目名 `crypto-top200`） |
| `package.json` | 锁定 wrangler 版本（当前 4.159.0）与部署/冒烟命令脚本 |
| `scripts/deploy.sh` | 唯一部署入口：数据一致性门禁 → Wrangler 直推 → 部署后冒烟 |
| `scripts/smoke.sh` | 部署冒烟断言（断言 JSON 契约，不只看状态码） |
| `scripts/probe.sh` | 本地健康探针：冒烟同组断言 + 数据新鲜度，结果追加到 `ops/probe-log.jsonl` |
| `scripts/*.py` | 从研究报告重新生成数据的脚本（一般用不到） |
| `CHANGELOG.md` | 每次生产部署一行记录 |
| `UPGRADE_PLAN.md` | 2026-11-10 全面审计与升级方案（本轮施工依据） |

## 部署（唯一方法：受限 API Token + Wrangler 直推）

前提（一次性）：在 Cloudflare 控制台创建一枚**受限 API Token**（仅授 Account → Cloudflare Pages → Edit 一项权限、限定本人账号、90 天到期），经安全通道交付保管，部署环境以环境变量 `CLOUDFLARE_API_TOKEN` 方式使用。Token 不写进任何仓库文件。本地首次使用先装依赖：

```bash
npm install
```

正式部署两步走（先预览、冒烟通过后才上生产）：

```bash
npm run deploy:preview   # 部署到 preview 分支，脚本会自动对预览地址跑冒烟
npm run deploy           # 部署到生产（main 分支），脚本会自动对 https://top200.oppcal.com 跑冒烟
```

`scripts/deploy.sh` 内部流程：校验 `data/coins.json` 与 `public/data/coins.json` 一致（不一致以 `data/` 为准同步，仍不一致则中止）→ 用 `package.json` 锁定的 wrangler 版本执行 `wrangler pages deploy public --project-name crypto-top200`（preview 加 `--branch preview`，production 加 `--branch main`）→ 对对应地址执行 `scripts/smoke.sh`。冒烟失败时脚本非零退出并提示「部署已上线但冒烟失败，需人工处理/回滚」。

手动单独冒烟：

```bash
npm run smoke                              # 对生产地址
bash scripts/smoke.sh https://preview.crypto-top200.pages.dev
```

## 已废弃：控制台拖放部署（不要再用）

**已废弃：控制台拖放不编译 functions/，会导致 /api/board 失效（2026-11-10 审计结论）**。首次上线用的就是拖放直传：`functions/api/board.js` 被当成静态文件，`/api/board` 返回的是首页 HTML（HTTP 200），前端静默回退快照——故障被降级设计伪装成了「可用」。此后任何一次拖放更新都会让故障永久持续。部署只走上面的 Wrangler 直推，没有第二种方法。旧的 `dist-upload/` 与 `upload.zip` 拖放产物已移入项目外的归档目录，不要再生成这类拍平目录/zip 包。

## 换数据再部署（一步完成）

改 `public/data/coins.json` 与 `data/coins.json`（两份须一致，`deploy.sh` 会校验并以 `data/` 为准同步）后 `npm run deploy` 即可。细则：

- 改预估区间改 `estLo` / `estHi`（预估下限/上限，美元）。
- 增删币种：新增条目必须带正确的 `coingeckoId`（在 coingecko.com 搜币名，网址里 `/en/coins/` 后面那段就是 id），否则该币没有实时价。
- 改完先本地双击 `public/index.html` 看一眼排版没坏，再部署；部署后脚本自动冒烟。

## 回滚方法

- **控制台一键回滚**：Cloudflare 控制台 → Workers & Pages → `crypto-top200` → Deployments → 选中上一个正常的生产部署 → Rollback，即时生效。
- **API / 命令行**：用同一枚受限 Token 调用 Pages 部署 API 回滚到指定部署，或把 Git 里上一个 tag 的产物用 `scripts/deploy.sh production` 重新推一遍。
- 回滚后跑一次 `npm run smoke` 确认接口与页面恢复。

## 冒烟与探针

- 冒烟（`scripts/smoke.sh <基址>`）：断言 ① `/api/board` 返回 200 且 Content-Type 为 JSON；② body 含 `coins`、`updatedAt`、`coverage`；③ body 不含 `<!DOCTYPE html`（负向断言，专防 HTML 冒充接口）；④ `coverage.returned` 不低于 `/data/coins.json` 币数的 94%；⑤ 首页 200 且含「市值前 200 币种」；⑥ `/data/coins.json` 200 且可解析。任一失败非零退出。
- 探针（`scripts/probe.sh <基址>`）：同一组断言外加新鲜度判定（`updatedAt` 距今 ≤15 分钟为 pass；stale 且年龄 ≤3600 秒为 warn；snapshot 模式为 fail），每次运行把一行 JSON 结果追加到 `ops/probe-log.jsonl`。告警邮箱预留环境变量 `PROBE_ALERT_EMAIL`：未设置时只记录不发送；真实外部探针服务（邮件告警）待站长提供邮箱后另行接入。

## CoinGecko API key（Secret 方式）

可选但推荐：到 CoinGecko 申请免费 Demo key，用 Secret 方式写入（不要写进任何文件、不要用普通明文环境变量）：

```bash
npx wrangler pages secret put COINGECKO_API_KEY --project-name crypto-top200
```

改 Secret 后必须重新部署才生效。生产与 Preview 可各用一把；轮换流程：新建 → 替换并重新部署 → 在 CoinGecko 后台吊销旧 key。

## 本地预览（可选）

```bash
npx wrangler pages dev public
```

浏览器打开它给的本地地址，效果与线上一致（含实时行情）。

## 费用与免费额度

- Cloudflare Pages 免费版：静态请求不限量，个人站足够。
- Pages Functions（行情代理）走 Workers 免费额度：每天 10 万次请求；本站有 120 秒服务端缓存，实际打到 CoinGecko 的次数很少，正常访问量远用不完。
- CoinGecko 公共接口免费；配 Demo key 后额度为自己名下可计量的 10,000 次/月。

## 运维节奏

- **每次部署后**：冒烟（`deploy.sh` 已自动执行）+ 探针跑一次（`bash scripts/probe.sh`），结果留档在 `ops/probe-log.jsonl`。
- **触发式介入**：只在部署后、数据更新时、探针告警经站长转达时、站长选定的复核时间点介入，不做长期盯盘。
- **下一次复核点：2026-11-21**（底部窗口关闭后的一次性复核，清单见 `UPGRADE_PLAN.md` §6.5）。
- **季度体检**：部署 Token（90 天到期）与 CoinGecko key 的有效期、wrangler 锁定版本、回滚演练、合规自查（免责三处在位、无商业链接、数据署名正确）。

## 数据与口径说明

- 实时行情：CoinGecko（经 `functions/api/board.js` 代理，缓存 120 秒；上游故障时自动回退最近缓存并标注）。
- 预估数据：全表 182 个币全部可预估。构成：原报告表 A 158 条为基础，剔除原表 B 43 个锚定类（稳定币/黄金代币/代币化基金/包装资产等），按市值顺延补入 43 个非锚定币；其中 19 个与原表尾部重复、已按补位数据更新不重复计数，实际新增 24 个。原表 A 第 157 行 XTZ/SHFL 合并行已拆为两条。
- 数据日期：老币价格/市值为 CoinGecko 口径 2026-11-08 日收盘（与 CoinMarketCap 交叉核对；101–200 名的 ATH 部分为聚合口径约值）；补位币为 2026-11-10 CoinGecko 实盘核验，前端在「报告现排名」列以「11-10核验」标记。
- CoinGecko ID 映射已在 2026-11-10 逐一在线核定。易混项特别注意：TEL 用 `telcoin-2`（`telcoin` 是已废弃旧合约）、BCG 在 CoinGecko 的 id 是 `bc-token`（符号 BC）、PRL 是 `pearl-2`（符号 PEARL）、WFI 是 `wefi`、BCAP 是 `blockchain-capital`、SATUSD 是 `satoshi-stablecoin`；补位批易混项：BR 是 `bedrock-token`、XCN 是 `chain-2`、B 是 `build-on`、SUPER 是 `superfarm`、SN64 是 `chutes`、S 是 `sonic-3`、AWE 是 `stp-network`。
