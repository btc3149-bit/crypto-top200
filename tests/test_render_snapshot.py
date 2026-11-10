#!/usr/bin/env python3
"""test_render_snapshot.py — W2-17 render_snapshot 负向/幂等测试。

覆盖：① 正常注入 200 行；② 重复运行字节级幂等；③ 源 199 条 → 非零退出且不写文件；
④ 删一处标记 → 非零退出；⑤ 标记重复 → 非零退出；⑥ REPORT_URL 非 https → 非零退出；
⑦ REPORT_URL 合法时两落点渲染且站外属性正确、清空后整段移除。
运行：python3 tests/test_render_snapshot.py（退出码 0 全过）。全部在临时目录操作，不碰仓库文件。
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "render_snapshot.py"

results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f" — {extra}" if extra and not cond else ""))


def run(coins, html, *extra):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--coins", str(coins), "--html", str(html), *extra],
        capture_output=True, text=True)


with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    src = json.loads((ROOT / "data/coins.json").read_text(encoding="utf-8"))
    coins_ok = td / "coins.json"
    coins_ok.write_text(json.dumps(src, ensure_ascii=False), encoding="utf-8")
    tpl = (ROOT / "public/index.html").read_text(encoding="utf-8")

    # ① 正常注入（用已注入页做模板亦应成功：标记仍在）
    h1 = td / "a.html"
    h1.write_text(tpl, encoding="utf-8")
    r = run(coins_ok, h1)
    out = h1.read_text(encoding="utf-8")
    check("① 正常注入退出码 0 且 200 行", r.returncode == 0 and out.count('data-snapshot="1"') == 200,
          r.stderr.strip())

    # ② 幂等：再跑一次字节不变
    before = h1.read_bytes()
    r = run(coins_ok, h1)
    check("② 重复运行字节级幂等", r.returncode == 0 and h1.read_bytes() == before)

    # ③ 源 199 条 → 失败且不写文件
    bad = dict(src)
    bad["coins"] = src["coins"][:199]
    coins_199 = td / "coins199.json"
    coins_199.write_text(json.dumps(bad, ensure_ascii=False), encoding="utf-8")
    h2 = td / "b.html"
    h2.write_text(tpl, encoding="utf-8")
    snap = h2.read_bytes()
    r = run(coins_199, h2)
    check("③ 源 199 条非零退出且文件未改", r.returncode != 0 and h2.read_bytes() == snap,
          f"rc={r.returncode}")

    # ④ 删一处标记 → 失败
    h3 = td / "c.html"
    h3.write_text(tpl.replace("<!-- SNAPSHOT:END -->", "", 1), encoding="utf-8")
    r = run(coins_ok, h3)
    check("④ 删一处标记非零退出", r.returncode != 0, f"rc={r.returncode}")

    # ⑤ 标记重复 → 失败
    h4 = td / "d.html"
    h4.write_text(tpl.replace("<!-- SNAPSHOT:BEGIN -->",
                              "<!-- SNAPSHOT:BEGIN -->\n<!-- SNAPSHOT:BEGIN -->", 1),
                  encoding="utf-8")
    r = run(coins_ok, h4)
    check("⑤ 标记重复非零退出", r.returncode != 0, f"rc={r.returncode}")

    # ⑥ REPORT_URL 非 https → 失败
    h5 = td / "e.html"
    h5.write_text(tpl, encoding="utf-8")
    r = run(coins_ok, h5, "--report-url", "http://example.com/report")
    check("⑥ REPORT_URL 非 https 非零退出", r.returncode != 0, f"rc={r.returncode}")

    # ⑦ 合法站外 URL：两落点渲染 + 属性正确；再以空 URL 跑 → 整段移除、无 href="#"
    h6 = td / "f.html"
    h6.write_text(tpl, encoding="utf-8")
    r = run(coins_ok, h6, "--report-url", "https://example.com/report")
    out = h6.read_text(encoding="utf-8")
    check("⑦a 站外回链两落点渲染+noopener",
          r.returncode == 0 and out.count('href="https://example.com/report"') == 2
          and out.count('href="https://example.com/report" target="_blank" rel="noopener"') == 2
          and "方法与数据口径：《市值前 200 加密货币下一轮牛市高点预估排名》" in out,
          r.stderr.strip())
    r = run(coins_ok, h6, "--report-url", "")
    out = h6.read_text(encoding="utf-8")
    check("⑦b 清空 URL 后链接整段移除且无死链",
          r.returncode == 0 and "example.com/report" not in out and 'href="#"' not in out)

failed = [n for n, ok in results if not ok]
print(f"\ntest_render_snapshot: {len(results) - len(failed)}/{len(results)} PASS")
sys.exit(1 if failed else 0)
