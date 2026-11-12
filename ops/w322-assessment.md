# W3-22 评估：coins.json 紧凑形态（rows）启用 —— 结论：不启用，回退并提交本评估

> 日期：2026-11-12。施工范围：管线侧（scripts/、workers/fetcher 生成脚本、tests/、data 与 public/data 产物）。
> 结论一句话：**rows 形态本身在管线侧可联动实现，但两条硬验收线在管线侧无解**——① gzip ≤16 KB 无损不可达（实测最优 20,071–20,403 B）；② 前端 `decodeCoinsData` 是桩，snapshot-verify 逐行 diff 必然 200/200 不一致，而修复点在禁改的 `public/index.html`；另有一处评估未登记的消费方 `functions/api/board.js` 同样只认对象形态（在本包范围外）。按施工规则「校验过不了且无法在管线侧解决 → 回退全部改动 + 书面评估」，本包以评估交付，**仓库内未保留任何管线改动**（全部实验在 /tmp 隔离副本完成；`data/coins.json`、`public/data/coins.json`、`workers/fetcher/coins.json` 三份仍为同字节对象形态，sha256 均为 `94c2e9ba06eb6185f370707b554781cc7bd98eb9f0b9c84007879d9ebfd29094`，gzip 24,513 B）。

---

## 一、已验证事实（现状调查）

### 1. 当前形态
- `data/coins.json` = `{meta, coins:[200 个对象]}`，132,138 B，gzip（CLI 默认）24,513 B（评估文档记 24,518 B，同量级）。meta **无 `fields` 字段**，顶层无 `rows`。
- 每币 23 个字段，字段序以 `scripts/build.py` 的 `FIELDS23` 为准（validate/coerce/diff 均用它）：
  `table, estRank, rankNow, rankNote, name, symbol, coingeckoId, snapshotPrice, snapshotMcapUsd, snapshotMcapRaw, athPrice, athDate, athFlag, estLo, estHi, multLo, multHi, impliedMcapLoUsd, impliedMcapHiUsd, impliedMcapRaw, confidence, reason, dataDate`
- `meta.dataHash` 现值 `sha256:264c2b2074f3677d647309579259c81d2b210661ae3133138747f9e0f9beaac4`，口径 = `check_meta.data_hash(coins)`：对 **coins 对象数组** 做 `json.dumps(sort_keys=True, separators=(",",":"))` 后 sha256（`scripts/check_meta.py:15-17`，build.py 经 `data_hash()` 转调同一函数）。

### 2. 前端解码器是桩（P2-05/W3-22 的「前端零改动」前提不成立）
`public/index.html` 第 877–882 行（只读核查，未改动）：
```js
function decodeCoinsData(data) {
  // 双形态解码器：现行对象形态直通；管线新形态（位置数组）交付后在此按 meta 字段序解码，全站只见规范对象。
  if (data && Array.isArray(data.coins)) return data.coins;
  if (data && Array.isArray(data.rows)) return data.rows;   // ← 直接把位置数组当币对象返回
  return [];
}
```
注释自述「在此按 meta 字段序解码」，代码并未解码。下游全部按对象消费：`rebuildDerived()` 读 `c.coingeckoId/c.snapshotPrice/...` 并挂 `c._d`，`rowHTML/detailHTML/parseHashTarget` 均读具名属性。rows 喂入时每币所有具名属性为 `undefined`。

### 3. coins.json 消费方全清单（grep 实查，含评估未登记者）
| 消费方 | 读法 | 在本包范围 |
|---|---|---|
| `public/index.html` `decodeCoinsData`+下游 | `data.coins` / 桩 `data.rows` | ✗ 禁改（协调者） |
| `functions/api/board.js` `getIds()`（约 183–202 行） | `data.coins` 数组取 `coingeckoId`，否则抛 `ids_parse_failed` | ✗ 范围外（functions/） |
| `scripts/build.py` | `doc["coins"]`（--emit 校验、全量构建 prior/validate/build_meta/diff/emit） | ✓ |
| `scripts/check_meta.py` | `doc.get("coins")` 算 dataHash/counts；`check_overrides` 读 `doc["coins"]` | ✓ |
| `scripts/render_snapshot.py` `run()` | `doc.get("coins")`，条数 !=200 即中止 | ✓ |
| `scripts/weekly_check.py` | `coins_doc["coins"]` | ✓ |
| `scripts/smoke.sh` / `scripts/probe.sh` | `len(doc["coins"])` 作 coverage 期望数 | ✓ |
| `scripts/gen-paprika-map.mjs` / `verify-paprika-coverage.mjs` | `.coins` 取 symbol/coingeckoId 等 | ✓ |
| `workers/fetcher/src/coins-list.js` 生成（node -e 等价脚本，见文件头/README） | 读 fetcher 副本 coins 取 `coingeckoId`（paprikaId 现全表无此字段，恒 null） | ✓ |
| `tests/snapshot-verify.mjs` | 读 `coinsDoc.coins` 建桩 + 把原文档喂给真实页面脚本跑 diff | ✓（但见阻塞点 2） |
| `tests/test_render_snapshot.py` | `src["coins"][:199]` 造负向样本 | ✓ |
| `tests/board*.test.mjs` | 自带 mock `{coins:[{coingeckoId}]}`，不读真实文件 | ✓（不受形态影响，仍全过） |
| deploy.sh 门禁 | sha256(data)==sha256(public/data) + check_meta + fetcher 副本 meta.dataHash 对账 | 不动（见第四节方案） |

### 4. 基线（改动前，真实仓库全量实跑，全绿）
check_meta 11 pass/0 fail；check_overrides 0 fail；snapshot-verify 5/5；board.test 7/7；board-v2 12/12；board-fetcher 8/8；test_render_snapshot 8/8；三份 coins.json 同 sha256。

---

## 二、隔离实验结果（/tmp 副本，未碰真实仓库）

把三份 coins.json 转为 rows 形态（`{meta:{..., fields:FIELDS23}, rows:[[按 FIELDS23 取值]...]}`，紧凑分隔符），实测：

### 实验 A：不做任何联动，直接跑既有校验
- check_meta：**4 fail**（R2 dataHash 不符；R3 counts 全部算成 0）。
- render_snapshot：**中止**「源条数 0 != 200」。
- test_render_snapshot：`KeyError: 'coins'`（测试自身按对象形态造样本）。
- snapshot-verify：② 逐行 diff FAIL（详见实验 B），场景 C 在测试自身 `coinsDoc.coins` 处 TypeError 崩溃。

### 实验 B：管线侧联动后（check_meta/render_snapshot 增加 rows→对象解码）
- check_meta：**0 fail**（副本内 R4 因报告路径不在场降为 WARN，属副本路径artifact；逻辑项全过）。关键：若 dataHash 定义为「解码后对象数组的规范化哈希」（见第四节口径 A），**dataHash 与现值逐字相同**，fetcher 门禁基准不动。
- render_snapshot：**ok，200 行注入成功**。
- snapshot-verify：①③③ 过；**② 逐行 diff 仍 FAIL：200 行全部不一致（diffs=200）**——前端桩把位置数组交给 rowHTML，渲染出全空字段行。此失败与管线联动无关，只取决于 index.html 内的解码器。
- board.js 桩测（fetch 喂真实 rows 文档 + 正常 markets/global mock）：`getIds` 走失败回退，响应 `mode=snapshot, coverage.expected=0`；对照对象形态文档：`expected=200` 且 missingIds 为完整 200 id 清单（其余差异仅因 mock markets 只给 4 币触发覆盖门禁）。即 **rows 上线后 legacy 读路径永远取不到 id 列表、实时行情恒回退快照**，kv/dual 路径同理受 dualCompare 外 legacy 主路径影响。

### 实验 C：gzip 体积（验收线 ≤16 KB）
| 形态 | 原始 B | gzip（CLI 默认） | gzip -9 |
|---|---|---|---|
| 现行对象形态 | 132,138 | 24,513 | 23,458* |
| rows（紧凑分隔符） | 53,175 | **20,403** | 20,212 |
| rows + 全部低基数列字典编码（table/athFlag/confidence/dataDate/rankNote 改整数码） | 47,316 | **20,071** | — |

*对象形态 gzip -9 为 Python gzip 口径，量级参考。无论何种口径，rows 最优 ~20.1 KB，**距 16 KB（16,384 B）差约 3.7–4.0 KB（超 23–25%）**。评估文档「预估削减 30–45%」与实测不符：实际仅削减约 16.8%——原因是字段名重复串正是 gzip 最擅长压缩的部分，删掉它对 gzip 增益有限；体积下限由唯一内容决定（`reason` 一列原文 14,659 B、gzip 后独占 6,682 B；name/symbol/coingeckoId/两组 *Raw 展示串均为每币唯一值）。

**无损不可达的证据（为何不能靠删列补足差额）**：`snapshotMcapRaw`/`impliedMcapRaw` 不是其数值字段的确定函数，删列即丢数据——反例：VIRTUAL 的 snapshotMcapRaw 为 `"$3.60亿"`（报告原文保留两位小数，规范化格式应为 `$3.6亿`）、TEL 为 `"~$2.0亿"`（带 ~ 前缀）、SHIB 为 `"$26.0亿"`。其余可编码冗余（低基数列）已在实验 C 全量计入，仍差 ~3.7 KB。再往下只能动 reason 原文或改字段语义（如金额缩放编码），均超出「rows 位置数组」形态定义且破坏 200/200 完整性口径。

---

## 三、阻塞点（按决定性排序）

1. **gzip ≤16 KB 验收线无损不可达**（管线侧无解）：rows 实测 20,403 B；叠加全部合法字典编码 20,071 B。需站长/协调者改线（如 ≤21 KB）或另行批准有损/语义变更方案，本包无权自改验收线。
2. **前端解码器未完工**（修复点禁改）：snapshot-verify ② 以真实页面脚本为准，桩解码下 200/200 diff。靠改 tests/snapshot-verify.mjs 注入假解码器让其「通过」属于削弱门禁，不做。
3. **`functions/api/board.js` `getIds()` 只认 `data.coins`**（范围外文件）：rows 上线即实时行情 id 列表恒失败、恒回退快照；其测试 mock 不读真实文件，本地测试全绿也测不出来，属上线即坏型风险。须协调者把 board.js 纳入联动（或明确授权扩围）后才可启用。

## 四、建议路径（协调者接手清单，管线联动已在隔离副本验证可行）

**启用顺序**：先落 ① 前端解码（下节规格）与 ② board.js 解码并各自回归 → 站长裁决 ③ gzip 验收线（建议按实测改 ≤21 KB，或接受 20.4 KB 定版）→ 最后一次性执行 ④ 管线联动并全量回归、三份产物同字节同步。

**④ 管线联动清单（逐文件，均已验证或机械可改）**：
- `scripts/check_meta.py`：新增 `decode_coins(doc)`（coins 在场直通；否则按 meta.fields zip rows）；`check_meta()` 与 `check_overrides()` 改走它。
- `scripts/render_snapshot.py`：`run()` 同样先解码再渲染（实验 B 已证 200 行 ok）。
- `scripts/build.py`：内部全程仍以对象数组为规范形态（parse/validate/build_meta/diff 不动）；仅 `emit()` 落盘时编码为 rows（三份同字节）；`--emit`/prior 读取与 `Resolver` 改走解码；`build_meta()` 写入 `fields=FIELDS23`。
- `scripts/weekly_check.py`、`smoke.sh`、`probe.sh`、`gen-paprika-map.mjs`、`verify-paprika-coverage.mjs`：读取处统一先解码（smoke/probe 的期望数改 `len(rows 或 coins)`）。
- `workers/fetcher/coins.json`：与 data 同字节复制；`coins-list.js` 生成脚本改按 fields 索引取 coingeckoId 列（第 7 列，索引 6）重生成，产物应与现文件逐字一致（id 序不变，paprikaId 恒 null）。
- `tests/snapshot-verify.mjs`：`coinsDoc.coins` 两处（场景 C 建 liveCoins）改用解码后对象；喂给页面脚本的仍须是 **原始 rows 文档**（否则测不到真实解码路径）。`tests/test_render_snapshot.py`：199 条负向样本改截 `rows`。
- **门禁不削弱方案**：deploy.sh 三道门禁（双目标 sha256 同字节、check_meta 对账、fetcher dataHash 对账）全部原样保留——源与产物同为 rows 形态、同字节，fetcher 副本同字节。
- **dataHash 口径（建议定版为口径 A，须明示）**：dataHash 继续定义为「解码后规范对象数组的 sha256」（逻辑数据集哈希，与线缆编码无关）。采用口径 A 则 **dataHash 不变**（仍为 `sha256:264c…ac4`），fetcher 门禁基准、历史比对均无扰动；若改按 rows 载荷哈希（口径 B），新值将变为 `sha256:8dbb56c44b57c664069b1cf694a58fe33eea5754f073246d7d8d4265851f09e3`，fetcher 门禁基准与一切历史 dataHash 记录需同步改口径——不推荐。

## 五、前端 `decodeCoinsData` 补全规格（给协调者，精确到函数级）

- **位置**：`public/index.html` 内 `decodeCoinsData(data)`（现第 877–882 行），仅改此函数，`init()` 及其余下游零改动。
- **字段序来源**：`data.meta.fields`（由 build.py 落盘时写入，恒等于 build.py `FIELDS23` 的 23 项，顺序见第一节）。**禁止在前端硬编码另一份字段表**——以 meta 为唯一来源，管线改序时前端自动跟随。
- **映射方式**：位置数组逐项 zip 成具名对象；值原样透传（JSON 类型不变，`null` 保持 `null`，数字不做任何舍入/缩放）；`data.coins` 对象形态分支保留（双形态兼容，回滚只需换回对象形态产物，前端不需再动）。
- **参考实现**（与桩的差异仅在 rows 分支）：
```js
function decodeCoinsData(data) {
  if (data && Array.isArray(data.coins)) return data.coins;
  if (data && Array.isArray(data.rows)) {
    const fields = data.meta && Array.isArray(data.meta.fields) ? data.meta.fields : null;
    if (!fields) return [];
    return data.rows.map((r) => {
      const o = {};
      for (let i = 0; i < fields.length; i++) o[fields[i]] = r[i];
      return o;
    });
  }
  return [];
}
```
- **验收**：补全后在 rows 产物下重跑 `node tests/snapshot-verify.mjs` 应 5/5（② diff=0 是决定项）；另手动核对展开详情（detailHTML 读 impliedMcapRaw 等具名字段）与 hash 直达各抽 1 币。
- **board.js 配套规格**（同理）：`getIds()` 取列表处改为先解码——`data.coins` 在场用之，否则用 `data.meta.fields` 中 `coingeckoId` 的索引从 `data.rows` 抽该列；其余逻辑（IDS 缓存、错误类型）不变；`tests/board.test.mjs` 与 board-v2 dual 用例的 coins.json mock 建议各加一个 rows 形态变体用例防回归。

---

## 六、本包实际交付

- 改动文件：仅本评估 `ops/w322-assessment.md`（新增）。管线脚本、tests、data/public 产物、fetcher 副本 **零改动零残留**（实验全程在 /tmp 隔离副本；真实仓库 `git status` 中 index.html/_headers 的既有未提交修改为其他工作包在途工作，与本包无关、未触碰）。
- 未部署、未 git commit（遵嘱）。
- 跑过的校验：基线全量（见第一节 4，全绿，对象形态现状）；隔离实验 A/B/C（结果见第二节，含 gzip 三种口径实测、check_meta/render_snapshot 联动验证、snapshot-verify 与 board.js 桩测的失败证据）。
