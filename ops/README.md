# ops/ 目录规范（W2-15 定版）

本站运营留痕统一放本目录。原则：清单可勾验、每项有判据、勾完即存档，不靠口头汇报。

## 目录结构

```
ops/
  README.md                  # 本规范
  probe-log.jsonl            # 探针运行日志（既有，只追加不改写；历史记录加注不删）
  probe-config.md            # W2-13 监控/HC 清单（名称、ID、对象、断言原文）
  signoffs.md                # U3/U4/U7 等用户确认的签收行
  checklists.md              # 四触发点动作清单（部署后/数据更新/告警转达/选定复核点）
  seo-head-snippet.html      # W2-16 head 定版片段（待协调者合入 index.html 后本文件留作版本对照）
  reviews/                   # 选定复核点报告：YYYY-MM-DD-review.md
  quarterly/                 # 季度体检：YYYY-Qn-checklist.md（每季一份）
  incidents/                 # 告警事件留痕：YYYY-MM-DD-<slug>.md（触发即建）
  compliance-log/            # 合规自查留痕：YYYY-Qn.md（事件加跑为 YYYY-Qn-extra-<slug>.md）
  security/                  # 密钥台账与轮换剧本（只记元数据，永不记值）
  design/                    # 设计源稿（如 OG 图 PNG 源稿；不部署）
  headers/                   # W2-18 _headers 模板与生成脚本（归 W2-18 施工，本规范不代管其内容）
```

注：`ops/weekly/` 与 `ops/build-reports/` 为数据链工作包（W2-11/W2-12）的留痕目录，不在本规范管辖内，命名与内容由其工作包定版。

## 命名规范

- 日期一律 `YYYY-MM-DD`（ISO），季度一律 `YYYY-Qn`；slug 用小写英文连字符。
- 文件名定版后不改名；修订在文件内记版本/日期，不另存「最终版2」式副本。

## 红线（禁存清单）

- **禁止存入**：任何密钥/token 的值或片段、healthchecks ping URL 全文、完整 API token、用户个人信息。
- 只允许记：密钥**后四位**、到期日、轮换日期、监控 ID、文件哈希。
- 季度体检 Q5 的 tail 演练只存脱敏说明与「可达/不可达」结论，禁止把含请求头/密钥的日志原文存入本目录。

## 只追加原则

- `probe-log.jsonl` 只许在文件末尾追加新行，不许改写、删除历史行；历史失败记录需要说明时，另在对应事件/复核文件中加注，不回改原行。
- 其余留痕文件：已定稿的报告（reviews/quarterly/compliance-log/incidents）如需更正，在文末追加「更正记录」小节并署日期，不覆盖原文。

## 部署隔离

- 本目录**不在部署目录内**：部署目录仅为 `public/`（`wrangler.toml` 的 `pages_build_output_dir = "public"` 已证）。本目录任何文件不得复制进 `public/` 充当留痕。
- 线上访问 `/ops/...` 的实测行为记录在 `compliance-log/2026-Q4.md`（Pages 对未命中路径返回首页回退页，ops 内容本身从未上线）。
