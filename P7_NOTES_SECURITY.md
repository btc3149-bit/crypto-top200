# P7_NOTES_SECURITY — 第七期批 6 安全治理（F7-45 / F7-46 / F7-47）

分支 `p7-security`，独立 worktree 施工；未部署、未 push。未改 `public/index.html`、`functions/`、`workers/fetcher/src/`、`workers/fetcher/README.md`（按分工禁改，见 §4 协调清单）。

---

## 1. F7-45 wrangler 锁版收口

### 盘点（裸 `npx wrangler` / 裸 `wrangler` 高权或可执行命令）
| 位置 | 形态 | 处置 |
|---|---|---|
| `README.md:73` | `npx wrangler pages dev public` | ✅ 改锁版入口 |
| `README.md:116` | `npx wrangler pages secret put COINGECKO_API_KEY …`（高权：密钥注入） | ✅ 改锁版入口 |
| `README.md:124` | `npx wrangler pages dev public` | ✅ 改锁版入口 |
| `ops/security/rotation-playbook.md:26` | `npx wrangler pages secret put …`（高权） | ✅ 改锁版入口 + F7-45 注记 |
| `ops/quarterly/2027-Q1-checklist.md:13`（Q5 指令列） | `wrangler pages deployment tail` | ✅ 改锁版入口（同行结果列是 2026-11-10 历史实测记录，未改） |
| `scripts/deploy.sh:153` 注释 | `npx wrangler deploy -c workers/fetcher/wrangler.toml` | ✅ 改锁版入口写法 |
| `scripts/deploy.sh:187` | `npx wrangler@${WRANGLER_VERSION} …`（已锁版但内联） | ✅ 改经统一入口（见下） |
| `docs/fetcher-runbook.md` | 无裸命令（仅文字提及 wrangler.toml） | ✅ 新增「wrangler 锁版（F7-45）」条目，含 fetcher 部署/secret 的锁版命令形态 |
| `workers/fetcher/README.md:9,11,16` | 裸 `wrangler secret put` / `npx wrangler deploy` | ⛔ 按分工未改（data 组并行重写），替换清单见 §4 |
| `scripts/quota-check.py`、`scripts/check-shadow-health.py` | 已从 package.json 读 pin 拼 `wrangler@{pin}` | 原本即锁版，未动 |
| 历史记录类（UPGRADE_PLAN、CONSTRUCTION_*、ops/disaster-recovery/rollback-drill、key-ledger 的「经 wrangler secret put 注入」叙述等） | 过去时叙述/史实 | 未动（非现行操作指令） |

### 统一入口 `scripts/wrangler-pinned.sh`（新增）
- 版本唯一来源 = `package.json` 的 `devDependencies.wrangler`（脚本内无硬编码版本；pin 须为精确版本，非精确即拒绝）；
- `package-lock.json` 存在时校验 lockfile 中 wrangler 版本与 pin 一致，不一致中止（与 deploy.sh W4-17 同口径）；
- 本地 `node_modules/.bin/wrangler` 存在且 `--version` 与 pin 一致 → 直接 exec 本地二进制（离线可用）；否则回退 `npx --yes wrangler@<pin>`（仍锁版）；
- 其余参数原样透传；无参数退出 2；
- 测试钩子：`WRANGLER_PINNED_LOCAL_BIN` 可指定本地二进制路径（仍校验版本==pin），生产运维不设此变量。

### deploy.sh 衔接
- (c) 部署步改经 `bash scripts/wrangler-pinned.sh pages deploy …`，与原内联 `npx wrangler@<pin>` 等价（pin/lockfile 校验在入口内重做一次），回滚/门禁其余逻辑未动。

### 测试证据
- `tests/wrangler-pinned.test.mjs`（新增，已注册进 `scripts/run-tests.sh`）：桩二进制 4/4 PASS——① `--version` 透传且等于 pin 4.159.0；② 参数逐项原样透传（pages secret list --project-name crypto-top200）；③ 无参数退出 2；④ 版本不一致的桩不被执行、改走 `npx --yes wrangler@4.159.0` 且参数透传（桩 npx 记录验证）。
- 真二进制验证（本 worktree 无 node_modules，用环境变量指向主仓库已装 wrangler）：`WRANGLER_PINNED_LOCAL_BIN=~/workspace/cloudflare-top200-site/node_modules/.bin/wrangler bash scripts/wrangler-pinned.sh --version` → 输出 `4.159.0`，退出 0。
- 无本地二进制时回退路径实测：直接 `bash scripts/wrangler-pinned.sh --version`（经 npx 拉锁版）→ 输出 `4.159.0`，退出 0。
- 全程未做任何生产写操作（只跑 --version / 桩命令）。

---

## 2. F7-46 依赖审计可复现化

### 实际尝试（2026-11-23，本沙箱）
1. `npm audit --json`：**失败**——注册表端点返回 403 Forbidden，类别 `policy_denied`（POST /-/npm/v1/security/audits/quick 被环境注册表策略拒绝）。与评审实测一致；未抄录任何敏感信息。
2. `osv-scanner`：**不可用**——`which osv-scanner` 无结果，本机未安装。
3. OSV 公共 API 直连（api.osv.dev/v1/query）：**未完成**——请求未返回结果且该步审批超时未获批准，按指示未重试。**因此本期没有任何真实审计结果，结论只能是「未审计」。**

### 交付
- 新增 `scripts/audit-deps.mjs`：零依赖、无需凭证；从 `package-lock.json` 枚举全部包（实测 91 个，含 wrangler 传递依赖与平台可选包），按 name@version 排序去重后经 OSV `querybatch` 批量查询、逐条取 `vulns` 明细，输出漏洞计数/明细/审计日期（UTC）；支持 `--list`（离线仅枚举）、`--out=<path>` 写 JSON 报告、`OSV_API_BASE` 覆盖基址（测试用）。退出码语义：0=已审计且 0 漏洞 / 1=已审计且有漏洞 / **2=未完成审计**（网络/上游失败时 stderr 明示「未审计」，绝不冒充 0 漏洞）；单请求 20 秒超时。
- 登记：`ops/security/security-baseline.md` 新增 §5.5——当期结论「未审计（不是 0 漏洞）」、三条已尝试路径及失败类别、依赖面事实（仅 devDependency wrangler 4.159.0、无运行时依赖）、补跑方法（可直达 api.osv.dev 的环境跑本脚本并回填工具/日期/计数，或不受限环境跑 npm audit / osv-scanner）。
- 第六期「npm audit 0 漏洞」自此不得再沿用引用（已写入 §5.5）。

### 测试证据
- `tests/audit-deps.test.mjs`（新增，已注册进 run-tests.sh）：4/4 PASS——① enumeratePackages 枚举/排序/去重（含嵌套 node_modules 与 scope 包）；② 本地桩 OSV（querybatch+vulns）→ 汇总漏洞 1 条、明细含 `wrangler@4.159.0 GHSA-TEST-0001`、退出 1；③ 上游不可达 → 退出 2 且输出含「未审计」、不含「漏洞 0 条」；④ `--list` 离线枚举真实 lockfile 含 wrangler@4.159.0。
- 另以独立进程桩服务手工验证过完整流程跑通（91 包查询返回、正常汇总退出）——桩返回为空，**该次结果不是真实 OSV 审计**，不作漏洞结论引用。
- 踩坑留痕：测试初版用 spawnSync 调子进程查同进程桩服务，阻塞事件循环导致桩无法响应、子进程超时退出 2；改异步 spawn 后 0.6 秒全过。

---

## 3. F7-47 report-only 产物纳入 --check 并重新生成

### 生成器能力核查
- `ops/headers/gen-headers.mjs` 原本已支持 `--report-only` 与 `--check` 组合（默认 out 指向 report-only 文件），但有三处缺口：① report-only 默认变体为 WA-OFF（陈旧产物即此形态：2026-11-10、WA-OFF、style 计数 6 处、无 ACAO 行）；② --check 失败时的处置提示恒指向 public/_headers 的重生成命令，对 report-only 是错的；③ deploy.sh 门禁只校验 public/_headers，report-only 无任何门禁覆盖。

### 处置（纳入而非退役）
- gen-headers.mjs：`--report-only` 现**强制显式 `--variant`**（生成与 --check 均然），未传即退出 2 并给出 WA-ON 正确命令，防再产 WA-OFF 陈旧件；--check 失败提示按 reportOnly 上下文给出正确重生成命令；文件头用法注释补 `--check --report-only --variant=on`。
- 重新生成：`node ops/headers/gen-headers.mjs --report-only --variant=on` → 产物头 `variant: WA-ON+report-only; generated: 2026-11-23T05:05:01Z; index.html sha256: 8a6b412d…`（与现行 public/_headers 同一 sha），CSP 与线上逐字一致、仅头名为 `Content-Security-Policy-Report-Only`，含现行 ACAO 单一来源行与首页 SWR 组，style 计数更新为 5 处。
- 门禁：deploy.sh 新增 (b2b) 段，部署时跑 `gen-headers.mjs --check --report-only --variant=on`，不一致即中止并给出重生成命令。

### 验证证据
- `node ops/headers/gen-headers.mjs --check --report-only --variant=on` → 通过（退出 0）。
- `node ops/headers/gen-headers.mjs --check --variant=on`（public/_headers）→ 通过（退出 0），且 `git diff public/` 为空——**public/_headers 未被改动**。
- `node ops/headers/gen-headers.mjs --check --report-only`（不带 variant）→ 退出 2 并报错（新守卫生效）。

---

## 4. 需协调人集成时处理（workers/fetcher/README.md，本组禁改）

data 组重写该文件时，请把以下命令替换为锁版入口（docs/fetcher-runbook.md 已先行给出同口径）：

| 行 | 现文 | 替换为 |
|---|---|---|
| :9 | `wrangler secret put COINGECKO_API_KEY -c workers/fetcher/wrangler.toml` | `bash scripts/wrangler-pinned.sh secret put COINGECKO_API_KEY -c workers/fetcher/wrangler.toml`（在仓库根执行） |
| :11 | 「已由施工方生成并以 wrangler secret put 注入」 | 可保留叙述，建议补「（经 scripts/wrangler-pinned.sh）」 |
| :16 | `npx wrangler deploy -c workers/fetcher/wrangler.toml` | `bash scripts/wrangler-pinned.sh deploy -c workers/fetcher/wrangler.toml` |

另：`scripts/run-tests.sh` 本组新增两行套件注册（wrangler-pinned / audit-deps），若其他组同改此文件，合并时保留这两行即可。

---

## 5. 测试汇总

- `bash scripts/run-tests.sh`：**17/17 套件通过**（原 15 + 新增 2），无回归。
- `bash -n` 校验：deploy.sh / run-tests.sh / wrangler-pinned.sh 语法 OK。
- gen-headers 双 --check 通过（见 §3）；public/_headers 零改动。
- 未部署、未 push、无任何生产写操作。
