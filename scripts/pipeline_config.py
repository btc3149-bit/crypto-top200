"""pipeline_config.py — 管线共享常量唯一定义处（build.py 与 weekly_check.py 共用）。

代码其他位置出现比值阈值字面量视为违规（W2-11 验收 grep）。
初版由 W2-12 落地（AUDIT_BAND / EXPECTED_TOTAL），W2-11 补 MULT_DRIFT_TOL。
"""
AUDIT_BAND = (0.35, 2.8)      # 在线核价：live/snapshot 比值合格带（三处旧脚本同值收敛于此）
EXPECTED_TOTAL = 200          # 终表行数断言（替代散落的 43/18/182/200 字面量断言）
MULT_DRIFT_TOL = 0.35         # 二轮补位倍数漂移容差（吸收 merge_refill2.py 的 0.35 断言；与 AUDIT_BAND 下限同值异义，勿混用）
DEVIATION_TOL = 0.20          # 周检 C6 多源偏离阈值（CoinCap vs CoinGecko 现价偏离 >20% 进人工队列）
REPORT_URL = "https://muse.ai/s/bi-quan-zhang-die-lun-hui-zhou-qi-shen-vxm6i0xnkxgexxf/bqL8_AqHCdtWR8tNQoaBkpjLv5cug36sV_UWIMO1C6Q"  # W2-17 研究报告回链（U4 已确认 2026-11-12：用户公开分享的周期报告页链接；空→两落点整段不渲染）
