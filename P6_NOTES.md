# P6_NOTES — 第六期批 2（前端）+ 批 6 前端测试项 逐条处置

施工员：前端施工员（分支 wt/p6-batch2-frontend）。拥有文件：`public/index.html`、
`tests/frontend-dom.test.mjs`、`tests/snapshot-verify.mjs`（未改任何他人文件）。
基线（改前）：frontend-dom 6/6 PASS 退出码 0；snapshot-verify 5/5 PASS 退出码 0。
改后：frontend-dom 16/16 PASS；snapshot-verify 5/5 PASS；仓库其余套件全绿
（board/board-v2/board-fetcher/fetcher-branches/contract-real-data + Python render 8/8、weekly 14/14）。

## 逐条处置

- **F6-12已修**：confSel 三个 `<option>` 加 `value="高"/"中"/"低"`（计数留文本）。
修复后行为：选任一置信度正常筛出对应币种（此前选任一必出空表）。回归测试 frontend-dom ⑦
以浏览器语义（select.value 取 option 的 value，无 value 时取文本）驱动 currentFiltered，
断言「高」恰筛出数据中的高置信度条数且非空。
- **F6-13已修**：effPrice/effMcap 改显式 null 判断（经 num() 归一）：
实时字段为 0/负数按缺失处理（返回 null），主表显「—」、不参与倍数计算、不回退快照价；
字段缺失（null/无条目）才按覆盖口径回退快照（原「快照价」标记不变）。detailHTML 的
实时市值改与主表共用同一 effMcap 结果——mcapUsd=0 时详情同显「—」，消除主表有值、
详情显「—」的同屏矛盾。测试 ⑨ 锁定（telcoin-2/wefi/yellow 形态：mcapUsd=0、price=0、rank=null）。
- **F6-14 已修**：新增 num() 数值归一（数字/数字字符串→Number，其余→null），fmtPrice/
fmtMcap/fmtPct/sig3 入口统一归一+Number.isFinite 复核，非数返回「—」，数字字符串价
不再抛 TypeError；loadBoard 与 init 两处 `rebuildDerived(); render();` 调用点包
try/catch，失败走 liveLayerFail()：不触碰 tbody（保留现有行/快照行）、横幅标注
「实时行情加载失败，显示快照数据」。测试 ⑧ 含字符串价整表渲染回归。
- **F6-63已修**：fmtPrice ≥1000 分支加 minimumFractionDigits:2（2127.5→
"2,127.50"）；p<0 返回「—」（不再把负价渲成 0）；fmtPct |x|<0.05 显示 "0.0%" 且新增
chgCls() 按舍入后值决定颜色（该区间不着色，主表/详情/总市值三处调用点统一）；fmtMcap
亿位 sig3 进位达 10000 时提升万亿重算（9.9995e11→"$1万亿"，不再 "$10000亿"；注：
sig3 按 W3-13 定版去尾零，故为 "$1万亿" 而非 "$1.00万亿"）。测试 ⑧ 逐项断言。
连带：快照静态行中 18 处 ≥1000 整数价（BTC/ETH 等价格、ATH、预估区间）随新格式变化，
已按新 rowHTML 再生全部 200 静态行（见文末协调人跟进 1）。
- **F6-62已修**：boardMode 显式识别 "delayed"；applyBoardState 新增 delayed
分支：横幅「行情延迟约 X 分钟 · 数据截至 …」（X=staleAgeSec 换算分钟）、徽标「行情延迟
（约 X 分钟）」，不再误称「上游暂不可达」。测试 ⑬ DOM 用例锁定（staleAgeSec=1200→20 分钟）。
- **F6-54已修**：loadWatch 提前到 init 最前执行、与 coins 取数成败无关，
按原始数组载入；失败态下点星经 toggleStar 更新原始集后落盘，不再以空集覆写已存自选。
测试 ⑮（coinsFail 场景：已存 solana 时点 bitcoin，落盘为两币）。
- **F6-55已修（二选一取轻量同步）**：init 在 syncWatchToBoard 后调
syncSnapshotStars()，对静态行做一次轻量星标同步（按 watchSet 回显 ★/☆ 与
aria-pressed）。未选「快照模式也走 render」：render 会整表替换构建快照行，与 W2-17
「失败路径不触碰 tbody」定版冲突；轻量同步只改星标按钮本身。board 转实时后
render/patch 仍以 watchSet 重写星标，口径一致。
- **F6-65已修**：新增 watchRawSet（落盘原始 id 集）与 watchSet（榜单内
显示子集）双集：loadWatch 全量载入原始集，syncWatchToBoard 只收敛显示集；
saveWatch 恒写原始集，不在榜单的自选不再被下一次保存永久删除。标注：metaText 在
watchOffBoard>0 时追加「· N 个自选已不在榜单」，watchToggle 同步设 title。测试 ⑭。
- **F6-56已修（二选一取可达收起入口）**：未采用「patch 后即清
livePatched」——那会使每次刷新渲染塌缩为 50 行，与 W3-05/snapshot-verify ④
「刷新恒 200」定版冲突。改为：renderShowAllBar 在 livePatched 全量态也显示
「收起为前 50 条」（act=less），点击后清 livePatched 并收起；此后「显示全部/收起」
循环与手动态一致。测试 ⑥ 锁定全流程（200→点收起→50→点显示全部→200）。
- **F6-57已修**：patchInPlace 在主行重排前摘下其详情行引用，修补后以
最新 detailHTML 重建详情单元格内容再随主行移动——实时到达后已展开详情不再残留
「—（无实时数据）」旧值，与主行实时价同屏一致。测试 ⑫（快照态展开 BTC→live 修补
→详情含实时市值且无「无实时数据」）。
- **F6-58 已修**：patchInPlace 跳过含 document.activeElement 的单元格做整体替换
（只同步 className），其余单元格照常替换；W3-05 注释已同步修正为与实现一致
（tr 节点不销毁、滚动不丢；单元格内按钮节点会被重建，焦点所在单元格跳过替换）。
残余：焦点落在其他单元格按钮上时仍会被重建（报告修复建议的二选一中取「跳过含
焦点单元格」方案，此残余即该方案边界）。DOM 桩不建模焦点（activeElement 恒
null），本条无桩内用例，靠代码守卫+注释口径锁定。
- **F6-60已修**：renderShowAllBar 的 filtered 判定计入 watchOnly
（只看自选时不再出现死按钮）；toggleStar 手工删行路径末尾补 renderShowAllBar()
调用，按钮计数随删行同步。测试 ⑥ 覆盖按钮状态机。
- **F6-61 已修**：applyHashTarget 的 document.title 名次按 boardMode 取同源名次
（live/stale/delayed 用 liveRank、snapshot 用 estRank）；onHashChange 无命中时
一并 hashTarget=null，Infinity 豁免不再残留。
- **F6-64 已修**：coinInnerHTML 展开按钮直接输出 `aria-controls='d-<id>'`；静态行
200 行同步再生（见 F6-63 连带项）；toggleExpand 改为恒设 aria-controls、不再
收起时移除，hash 直达（btn=null）展开的详情行关联自模板即成立。
- **F6-66 已修**：esc() 补 `'`→&#39; 与反引号→&#96;。全部 esc 使用点已检查：
现行 200 条数据无单引号/反引号字段值（已脚本核查 name/symbol/reason/confidence/
dataDate/rankNote/athDate/coingeckoId），snapshot-verify ② 逐行 diff 仍为 0、不破版。
- **F6-67 已修**：detailHTML/rowCells 的 estRank、rankNow、multLo/multHi、
impliedMcap、snapshotMcapUsd 一律经 num()/fmt* 归一后拼接，非有限数显占位；
liveMult 对 estLo/estHi 同样归一。与 F6-14 同批验收（测试 ⑧⑨）。
- **F6-59（疑似→确认）已修**：改前实测证据——把 coins.json 的 fields 中
coingeckoId 改名为 cgId 喂现行 decodeCoinsData：产出 200 条、首条
coingeckoId=undefined（垃圾行不触发兜底）；行元素改为对象：产出 200 个
`{"table":"A"}` 式垃圾对象。修：解码后最小健全性校验——全行须为数组且
行长==fields 长、首行 coingeckoId 为非空字符串且 estRank 为数字（对象形态
同检首行），不合即 throw，由 init 既有 catch 走快照兜底。测试 ⑩ 锁定两形态。
- **F6-68（疑似→确认）已修**：改前实测——现行 searchBlob：bitcoin 为
"bitcoinbtc"，"nbt" 命中（跨界子串）、avalanche-2 的 blob 为
"avalancheavax雪崩币"，搜 "avalanche-2" 不命中。修：searchBlob 改为
name/symbol/coingeckoId/别名以空格拼接（小写），跨界误命中消除、id 可搜。
测试 ⑪ 锁定（"avalanche-2" 恰命中一币、"nbt" 结果不含 bitcoin）。
- **F6-19 已修**：frontend-dom 的 liveCoins 补 volume24h（五字段齐全）；snapshot-verify
的 liveCoins 补 rank 与 volume24h；frontend-dom ③ 增加 detailHTML「24h 成交量」
段断言（仿市值/涨幅段，期望 fmtMcap(ETH_VOL)）。
- **F6-18（前端部分）已修**：frontend-dom ⑨ 增加 volume24h=null（并 rank=null、
price/mcapUsd=0）DOM 用例：detailHTML 不抛错、成交量段显「—（无实时数据）」。
fetcher/board 两段的 null 用例属其他批次，不在本批文件内。
- **F6-81（前端部分）已修**：frontend-dom.test.mjs 文件头、④ 标题与断言文案、
文件尾注中关于 F4-07「预期红」的过期标注全部删除/改正，与实跑一致
（现 16/16 PASS、退出码 0；红即真回归）。ops/testing/coverage-baseline.md
的过期记载不在本批拥有文件内，见文末跟进 2。
- **F6-82（疑似→已评估并修）**：评估结论——现行桩对未实现属性静默返回
undefined（且 getElementById 注册表自动建桩会掩盖元素缺失），页面新增 DOM
依赖时既可能假红也可能假绿；实测缺失形态：通用元素缺布局量（scrollWidth 等，
updHints 在读）、document 缺 activeElement（F6-58 修复新增读取）。修：两套件
通用元素桩与 document 桩加 Proxy 守卫，读取未实现且未赋值属性即抛
「桩未实现: <name>」；补齐布局量（恒 0）与 activeElement（恒 null）；两套件
文件头各维护「桩覆盖的 DOM API 清单」注释。tr 定制节点模型 API 面窄且自洽，
未加 Proxy（清单中注明）。残余：⑤⑭⑮ 对 saveWatch 100ms 防抖仍用 settle()
墙钟等待，属时序型断言，未在本批改动（桩已能区分其余假红来源）。

## 需协调人跟进事项

1. **静态行生成源未同步**：本批 200 行静态快照行已按新 rowHTML 再生（aria-controls、
fmtPrice ≥1000 两位小数）。生成源（build 侧脚本，非本批文件）仍是旧模板——若集成
时重新生成快照行，F6-63/F6-64 的静态侧形态会被回退且 snapshot-verify ② 会红；
请脚本批次同步生成侧的 fmtPrice 与展开按钮模板后再再生。
2. **F6-81 余项**：ops/testing/coverage-baseline.md 仍记「frontend-dom 退出码为 1」
等过期口径（非本批文件），请文档/测试批次加过期头注或重跑更新。
3. **部署**：index.html 有变更，集成部署时按既有纪律先跑 gen-headers 再部署
（本批未部署、未 push、未碰生产）。
4. **F6-18 余项**：null 全链用例的 fetcher-branches 与 board-v2 两段属其他批次，
本批仅落地前端段（⑨）。
