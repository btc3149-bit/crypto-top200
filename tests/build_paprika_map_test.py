#!/usr/bin/env python3
"""build_paprika_map_test.py — F7-17 离线单测（第七期批 4 新增套件）。

验证 build.py 的 load_paprika_map / extract_js_array 对 coins-list.js
排版不敏感：单行（现行形态）、多行逐对象、分号后无换行、等号后换行、
字符串内含方括号等形态都应解析出同一映射；畸形输入抛 ValueError。
旧实现（split("export const COINS = ") + split(";\\n")）在「分号后无换行」
形态下实测抛 JSONDecodeError（见 P7_NOTES_SCRIPTS.md F7-17 复现证据）。

运行：python3 tests/build_paprika_map_test.py（全过退出 0）
注：本套件尚未列入 scripts/run-tests.sh 的 SUITES 清单，请协调人纳入 manifest。
"""
import json, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build  # noqa: E402

PASS = []

def ok(name):
    PASS.append(name)
    print(f"PASS {name}")

REAL = build.load_paprika_map()
assert len(REAL) == 200, len(REAL)
assert REAL.get("filecoin") == "fil-filecoin"
ok("现行单行 coins-list.js 解析 200 条、抽查 filecoin 映射正确")

src_txt = (ROOT / "workers/fetcher/src/coins-list.js").read_text(encoding="utf-8")
arr = build.extract_js_array(src_txt)
assert len(arr) == 200

def via_tmp(text):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(text)
        name = f.name
    try:
        return build.load_paprika_map(name)
    finally:
        Path(name).unlink(missing_ok=True)

# 多行逐对象排版（旧实现靠运气、非保证）
pretty = "export const COINS = [\n" + ",\n".join(json.dumps(c, indent=1) for c in arr) + "\n];\n"
assert via_tmp(pretty) == REAL
ok("多行逐对象排版解析结果与单行一致")

# 分号后无换行 + 后续语句同行（旧实现实测抛错的形态）
compact = "export const COINS = " + json.dumps(arr) + "; export const IDS = COINS.map(c=>c.id);"
assert via_tmp(compact) == REAL
ok("分号后无换行/后续语句同行形态解析一致（旧实现在此形态抛 JSONDecodeError）")

# 等号后换行、数组前有注释行
wrapped = "// comment\nexport const COINS =\n  " + json.dumps(arr) + ";\n"
assert via_tmp(wrapped) == REAL
ok("等号后换行形态解析一致")

# 字符串值内含方括号/转义引号不干扰括号匹配
tricky = [{"id": "a]b", "paprikaId": 'x"y[z'}, {"id": "c", "paprikaId": None}]
got = build.extract_js_array("export const COINS = " + json.dumps(tricky) + ";")
assert got == tricky
ok("字符串内方括号/转义引号不干扰括号匹配")

# 畸形输入：无标记 / 括号未闭合 → ValueError（fail-closed，不静默返回空映射）
for bad in ("export const OTHER = [];", "export const COINS = [{\"id\": 1}"):
    try:
        build.extract_js_array(bad)
        raise AssertionError(f"畸形输入未抛错: {bad[:30]}")
    except ValueError:
        pass
ok("畸形输入（无标记/括号未闭合）抛 ValueError")

print(f"\nALL {len(PASS)} CHECKS PASSED")
