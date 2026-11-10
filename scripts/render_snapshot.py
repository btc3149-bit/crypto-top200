#!/usr/bin/env python3
"""render_snapshot.py — W2-17 构建期静态注入：把 data/coins.json 的 200 行榜单快照
预渲染为真实 <tr> 写进 public/index.html 的 SNAPSHOT 标记区（tbodyA 内）。

管线位置（W2-11 build.py 产物链）：emit（data→public 两份 coins.json 落盘）之后运行，
见 build.py --emit 与全量构建两条路径的接入点；也可单独运行：
  python3 scripts/render_snapshot.py [--coins <path>] [--html <path>]

口径：行模板逐字复刻 public/index.html 前端 JS 在快照模式（BOARD=null）下
rowHTML + fmtPrice/fmtMcap/athCellHTML/multCellHTML/confCellHTML 的输出，
仅多一个 data-snapshot="1" 属性。一致性由 tests/snapshot-verify.mjs 用 node
桩跑前端 rowHTML 逐行 diff 保证（diff 必须为 0）。

健壮性（方案写死）：标记缺失/重复、源条数 != EXPECTED_TOTAL、REPORT_URL 非 https
→ 非零退出中止，不写文件。重复运行幂等（只替换标记区与状态横幅文案）。
退出码：0 成功；2 输入/结构错误。
"""
import json
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from pipeline_config import EXPECTED_TOTAL, REPORT_URL  # noqa: E402

BEGIN = "<!-- SNAPSHOT:BEGIN -->"
END = "<!-- SNAPSHOT:END -->"

# ---------------- JS 格式化复刻（与 index.html 同口径） ----------------

def js_to_fixed(x, f):
    """Number.prototype.toFixed：对双精度浮点的精确十进制值做 half-up（同值取大）。"""
    q = Decimal(1).scaleb(-f)
    r = Decimal(x).quantize(q, rounding=ROUND_HALF_UP)
    return format(r, "f")


def _group_int(s):
    neg = s.startswith("-")
    if neg:
        s = s[1:]
    out = ""
    while len(s) > 3:
        out = "," + s[-3:] + out
        s = s[:-3]
    return ("-" if neg else "") + s + out


def fmt_price(p):
    if p is None or p != p or p in (float("inf"), float("-inf")):
        return "—"
    if p >= 1000:
        s = js_to_fixed(p, 2)
        ip, _, fp = s.partition(".")
        fp = fp.rstrip("0")
        return _group_int(ip) + ("." + fp if fp else "")
    if p >= 1:
        return js_to_fixed(p, 2)
    if p >= 0.01:
        return js_to_fixed(p, 4)
    # Number(p.toPrecision(4)).toString()
    d = Decimal(p)
    exp = d.adjusted()
    q = Decimal(1).scaleb(exp - 3)
    r = d.quantize(q, rounding=ROUND_HALF_UP)
    if r != 0 and abs(r) < Decimal("0.000001"):
        # JS 对 <1e-6 用指数记法，如 1.235e-7
        tup = r.normalize().as_tuple()
        digits = "".join(str(t) for t in tup.digits)
        mant = digits[0] + ("." + digits[1:] if len(digits) > 1 else "")
        return f"{mant}e{tup.exponent + len(digits) - 1}"
    s = format(r, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def fmt_mcap(v):
    if v is None or v != v or v in (float("inf"), float("-inf")) or v <= 0:
        return "—"
    if v >= 1e12:
        return "$" + js_to_fixed(v / 1e12, 2) + "万亿"
    if v >= 1e8:
        return "$" + js_to_fixed(v / 1e8, 0 if v >= 1e10 else 2) + "亿"
    return "$" + js_to_fixed(v / 1e4, 0) + "万"


_ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}


def esc(s):
    return re.sub(r'[&<>"]', lambda m: _ESC[m.group(0)], "" if s is None else str(s))


def ath_cell_html(c):
    date = f"<br><span class='sym'>{esc(c.get('athDate'))}</span>" if c.get("athDate") else ""
    if c.get("athFlag") == "unverified":
        return "<span class='badge unverified'>未核实</span>" + date
    if c.get("athPrice") is None:
        return "—" + date
    if c.get("athFlag") == "approx":
        return (fmt_price(c["athPrice"])
                + "<sup class='ath-flag' title='聚合口径约值' aria-label='约值'>†</sup>" + date)
    return fmt_price(c["athPrice"]) + date


def _mult(c):
    p = c.get("snapshotPrice")
    if not p or not c.get("estLo"):
        return None
    return {"lo": c["estLo"] / p, "hi": c["estHi"] / p,
            "mid": (c["estLo"] + c["estHi"]) / 2 / p}


def mult_cell_html(c):
    m = _mult(c)
    if m is None:
        return "—"
    base = js_to_fixed(m["lo"], 1) + "–" + js_to_fixed(m["hi"], 1) + "×"
    if m["mid"] >= 10:
        return "<strong>▲ " + base + "</strong><span class='sr-only'>（高倍数）</span>"
    if m["mid"] < 1:
        return "<span class='mult-warn'>▼ " + base + "</span><span class='sr-only'>（预估低于现价）</span>"
    return base


def conf_cell_html(c):
    conf = c.get("confidence")
    label = "低 · 谨慎" if conf == "低" else esc(conf)
    return f"<td class='conf-{esc(conf)}'>{label}</td>"


def compute_live_ranks(coins):
    """复刻 rebuildDerived+computeLiveRanks（快照模式）：按 multMid 降序（稳定排序）。"""
    def mid(c):
        m = _mult(c)
        return m["mid"] if m else None
    ordered = sorted(coins, key=lambda c: -(mid(c) if mid(c) is not None else -1))
    return {c["coingeckoId"]: i + 1 for i, c in enumerate(ordered)}


def row_html(c, live_rank):
    cid = esc(c.get("coingeckoId"))
    rank_now = c.get("rankNow")
    verified = "<br><span class='sym'>11-10核验</span>" if c.get("dataDate") == "2026-11-10" else ""
    return (
        f"<tr data-snapshot=\"1\" id='row-{cid}'>"
        f"<td>{live_rank if live_rank is not None else '—'}</td>"
        f"<td class='hm'>{c.get('estRank')}</td>"
        f"<td><button class='exp' type='button' data-exp='{cid}' aria-expanded='false' "
        f"aria-controls='d-{cid}' aria-label='展开 {esc(c.get('name'))} 详情'>▸</button>"
        f"<button class='star' type='button' data-star='{cid}' aria-pressed='false' "
        f"aria-label='收藏 {esc(c.get('name'))}'>☆</button>"
        f"<strong>{esc(c.get('name'))}</strong> <span class='sym'>{esc(c.get('symbol'))}</span></td>"
        f"<td>{fmt_price(c.get('snapshotPrice'))}</td>"
        f"<td class='hm '>—</td>"
        f"<td class='hm'>{fmt_mcap(c.get('snapshotMcapUsd'))}</td>"
        f"<td class='hm'>{rank_now if rank_now is not None else '—'}{verified}</td>"
        f"<td class='hm'>{ath_cell_html(c)}</td>"
        f"<td>{fmt_price(c.get('estLo'))}–{fmt_price(c.get('estHi'))}</td>"
        f"<td>{mult_cell_html(c)}</td>"
        f"{conf_cell_html(c)}"
        f"<td class='reason hm'>{esc(c.get('reason'))}</td></tr>"
    )


def render_rows(coins):
    ranks = compute_live_ranks(coins)
    ordered = sorted(coins, key=lambda c: c["estRank"])
    return [row_html(c, ranks.get(c["coingeckoId"])) for c in ordered]


# ---------------- 文案与回链 ----------------

def snapshot_time_text(generated_at):
    """meta.generatedAt（ISO）→ Asia/Shanghai 本地串，与前端 fmtTimeStr 口径一致。"""
    dt = datetime.fromisoformat(generated_at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    loc = dt.astimezone(ZoneInfo("Asia/Shanghai"))
    return loc.strftime("%Y/%m/%d %H:%M:%S")


def default_banner_text(generated_at):
    return f"快照数据 · 生成于 {snapshot_time_text(generated_at)}，正在加载实时行情…"


REPORT_NAME = "市值前 200 加密货币下一轮牛市高点预估排名"


def report_link_html(url, kind):
    """REPORT_URL 非空时生成回链；站外（非 top200.oppcal.com）新窗口+noopener，仅 https。"""
    external = not re.match(r"^https://top200\.oppcal\.com(?:[/:?#]|$)", url)
    attrs = ' target="_blank" rel="noopener"' if external else ""
    anchor = f"方法与数据口径：《{REPORT_NAME}》"
    if kind == "sub":
        return (f'<!-- REPORTLINK:SUB -->\n<div class="sub report-link">'
                f'<a href="{esc(url)}"{attrs}>{esc(anchor)}</a></div>')
    return (f'<!-- REPORTLINK:METHOD -->\n<p class="report-link">延伸阅读：'
            f'<a href="{esc(url)}"{attrs}>{esc(anchor)}</a></p>')


def apply_report_links(html, url):
    """两个落点整段渲染/移除，幂等。url 为空 → 只留占位注释，无链接元素。"""
    if url and not url.startswith("https://"):
        raise ValueError(f"REPORT_URL 仅允许 https 地址: {url!r}")
    if url and re.search(r"""["'<>\s]""", url):
        raise ValueError(f"REPORT_URL 含非法字符: {url!r}")
    for kind, pat in (
        ("sub", r'<!-- REPORTLINK:SUB -->(?:\n<div class="sub report-link">.*?</div>)?'),
        ("method", r'<!-- REPORTLINK:METHOD -->(?:\n<p class="report-link">.*?</p>)?'),
    ):
        repl = report_link_html(url, kind) if url else f"<!-- REPORTLINK:{kind.upper()} -->"
        html, n = re.subn(pat, lambda m: repl, html, count=1, flags=re.S)
        if n != 1:
            raise ValueError(f"回链落点标记 REPORTLINK:{kind.upper()} 缺失或重复（n={n}）")
    return html


# ---------------- 主流程 ----------------

class SnapshotError(Exception):
    pass


def run(coins_path, html_path, report_url=None):
    coins_path, html_path = Path(coins_path), Path(html_path)
    try:
        doc = json.loads(coins_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise SnapshotError(f"快照源读取失败 {coins_path}: {e}")
    coins = doc.get("coins") or []
    if len(coins) != EXPECTED_TOTAL:
        raise SnapshotError(f"源条数 {len(coins)} != {EXPECTED_TOTAL}，中止注入（宁可不发版，不发残表）")
    generated_at = (doc.get("meta") or {}).get("generatedAt")
    if not generated_at:
        raise SnapshotError("meta.generatedAt 缺失，无法标注快照时间")
    html = html_path.read_text(encoding="utf-8")
    if html.count(BEGIN) != 1 or html.count(END) != 1:
        raise SnapshotError(
            f"SNAPSHOT 标记缺失或重复：BEGIN×{html.count(BEGIN)} END×{html.count(END)}")
    if html.index(BEGIN) > html.index(END):
        raise SnapshotError("SNAPSHOT 标记顺序颠倒")
    rows = render_rows(coins)
    generated_line = f"<!-- generated:{generated_at} source:data/coins.json count:{len(rows)} -->"
    region = BEGIN + "\n" + generated_line + "\n" + "\n".join(rows) + "\n" + END
    html = html[:html.index(BEGIN)] + region + html[html.index(END) + len(END):]
    # 状态横幅默认态：文案 + data-snapshot-at（JS 失败文案取同一时间）
    banner_pat = re.compile(
        r'(<div class="status-banner snapshot" id="statusBanner"[^>]*?)'
        r'(?:\s+data-snapshot-at="[^"]*")?([^>]*>)[^<]*(</div>)')
    m = banner_pat.search(html)
    if not m:
        raise SnapshotError("状态横幅 #statusBanner 未找到或结构不符")
    html = (html[:m.start()] + m.group(1) + f' data-snapshot-at="{esc(generated_at)}"'
            + m.group(2) + default_banner_text(generated_at) + m.group(3) + html[m.end():])
    url = REPORT_URL if report_url is None else report_url
    try:
        html = apply_report_links(html, url)
    except ValueError as e:
        raise SnapshotError(str(e))
    html_path.write_text(html, encoding="utf-8")
    return {"count": len(rows), "generatedAt": generated_at, "html": str(html_path)}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)

    def opt(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    coins = opt("--coins", str(ROOT / "data/coins.json"))
    html = opt("--html", str(ROOT / "public/index.html"))
    url = opt("--report-url", None)
    try:
        r = run(coins, html, url)
    except SnapshotError as e:
        print(f"FAIL [render-snapshot] {e}", file=sys.stderr)
        return 2
    print(f"render-snapshot ok: rows={r['count']} generatedAt={r['generatedAt']} -> {r['html']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
