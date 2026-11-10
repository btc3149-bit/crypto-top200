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
