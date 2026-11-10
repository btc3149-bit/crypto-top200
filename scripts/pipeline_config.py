"""pipeline_config.py — 管线共享常量唯一定义处（build.py 与 weekly_check.py 共用）。

代码其他位置出现比值阈值字面量视为违规（W2-11 验收 grep）。
初版由 W2-12 落地（AUDIT_BAND / EXPECTED_TOTAL），W2-11 补 MULT_DRIFT_TOL。
"""
AUDIT_BAND = (0.35, 2.8)      # 在线核价：live/snapshot 比值合格带（三处旧脚本同值收敛于此）
EXPECTED_TOTAL = 200          # 终表行数断言（替代散落的 43/18/182/200 字面量断言）
