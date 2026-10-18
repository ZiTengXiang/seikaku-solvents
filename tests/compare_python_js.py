"""Python版(reference/core.py)と JS版(js/diagnosis.js)の診断結果が一致するか確かめる。

    .venv/Scripts/python tests/compare_python_js.py [--n 3000] [--seed 1] [--browser PATH]

1. いろいろな回答パターン(全問同じ・同点の出やすい回答・一様ランダム・偏りのあるランダム)を作り、
   Python版で診断する。
2. 同じ回答を tests/cases.js に書き、tests/compare.html を headless の Edge / Chrome で開いて
   JS版で診断させ、--dump-dom の出力から結果を取り出す。
3. 5特性の値・上位5柱のコードと並び順・順位・同率フラグは完全一致、距離・RMS誤差・誤差率・親和度は
   相対誤差 1e-12 以内(どちらも倍精度なので実際は一致するはず)を確かめる。
4. 重みつきの質問では特性がちょうど0.5にならず同点がほとんど出ないので、全問の重みを1にした版でも
   同じ比較をして、同順位・同率フラグ・ハッシュによる並び順の一致も確かめる。
data/site.js が reference/ と同じ質問・重みを使っていることも確かめる。
"""
import argparse
import html
import json
import random
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))
import core  # noqa: E402  reference/core.py(tools/build_data.py が元フォルダから写す)

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/chromium", "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def make_cases(n, seed):
    rng = random.Random(seed)
    cases = [[v] * 30 for v in (1, 2, 3, 4)]
    cases.append([4, 3, 4, 3, 2, 1, 2, 1, 2, 3, 4, 3, 4, 3, 2, 2, 2, 1, 3, 3, 4, 3, 4, 2, 2, 1, 2, 1, 2, 3])
    cases += [[1 + (i + k) % 4 for i in range(30)] for k in range(4)]
    cases += [[(1, 4)[(i // 5 + k) % 2] for i in range(30)] for k in range(2)]
    for i in range(n):
        if i % 3 == 0:  # 一様ランダム
            cases.append([rng.randint(1, 4) for _ in range(30)])
        elif i % 3 == 1:  # 人に近い偏り(中ほどの2・3が多い)
            cases.append(rng.choices([1, 2, 3, 4], weights=[1, 3, 3, 1], k=30))
        else:  # 一部の特性だけ極端(同点が出やすい)
            base = rng.choices([2, 3], k=30)
            for t in rng.sample(range(5), rng.randint(1, 3)):
                v = rng.choice([1, 4])
                for j in range(t, 30, 5):
                    base[j] = v
            cases.append(base)
    return cases


def python_results(cases, questions, gods):
    out = []
    for a in cases:
        r = core.diagnose(a, questions, gods, top_n=5)
        out.append({"scores": [s["value"] for s in r["scores"]],
                    "ranking": [[g["code"], g["rank"], g["tied"], g["distance"], g["rms_error"],
                                 g["error_pct"], g["affinity_pct"]] for g in r["ranking"]]})
    return out


def find_browser(explicit):
    for p in ([explicit] if explicit else BROWSERS):
        if p and Path(p).exists():
            return p
    sys.exit("Edge / Chrome が見つからない。--browser でパスを指定してください。")


def js_results(cases, browser, test_questions=None):
    js = "window.TEST_CASES = " + json.dumps(cases) + ";\n"
    if test_questions is not None:
        js += "window.TEST_QUESTIONS = " + json.dumps(test_questions, ensure_ascii=False) + ";\n"
    (ROOT / "tests" / "cases.js").write_text(js, encoding="utf-8")
    url = (ROOT / "tests" / "compare.html").resolve().as_uri()
    proc = subprocess.run(
        [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files",
         "--virtual-time-budget=60000", "--dump-dom", url],
        capture_output=True, timeout=300)
    dom = proc.stdout.decode("utf-8", "replace")
    m = re.search(r'<pre id="js-output">(.*?)</pre>', dom, re.S)
    if not m:
        status = re.search(r'<pre id="status">(.*?)</pre>', dom, re.S)
        sys.exit("JS版の出力が取れない: " + (html.unescape(status[1]) if status else dom[:500]))
    return json.loads(html.unescape(m[1]))


def close(x, y, rel=1e-12):
    return abs(x - y) <= rel * max(1.0, abs(x), abs(y))


def compare(cases, py, js, label):
    if len(py) != len(js):
        print(f"[{label}] 件数が違う: Python {len(py)} / JS {len(js)}")
        return [(-1, [], ["件数"])]
    failures, exact_floats, tie_first, tie_any = [], 0, 0, 0
    for i, (a, p, j) in enumerate(zip(cases, py, js)):
        problems = []
        if p["scores"] != j["scores"]:
            problems.append(f"5特性 {p['scores']} != {j['scores']}")
        if [r[:3] for r in p["ranking"]] != [r[:3] for r in j["ranking"]]:
            problems.append(f"順位 {[r[:3] for r in p['ranking']]} != {[r[:3] for r in j['ranking']]}")
        for rp, rj in zip(p["ranking"], j["ranking"]):
            for x, y in zip(rp[3:], rj[3:]):
                if not close(x, y):
                    problems.append(f"{rp[0]} の数値 {rp[3:]} != {rj[3:]}")
                    break
                exact_floats += x == y
        tie_first += p["ranking"][0][2]
        tie_any += any(r[2] for r in p["ranking"])
        if problems:
            failures.append((i, a, problems))
    print(f"[{label}] {len(cases)} 件: 1位が同率 {tie_first} 件・上位5柱に同率あり {tie_any} 件、"
          f"数値の完全一致 {exact_floats}/{len(cases) * 5 * 4}、不一致 {len(failures)} 件")
    for i, a, problems in failures[:10]:
        print(f"  NG #{i} 回答 {','.join(map(str, a))}")
        for pr in problems:
            print("     ", pr)
    return failures


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--n", type=int, default=3000, help="ランダムな回答パターンの数")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--browser")
    args = ap.parse_args()

    questions = core.load_questions(ROOT / "reference" / "questions.json")
    gods = core.load_gods(ROOT / "reference" / "gods.json")

    # サイトのデータが reference と同じ質問・重みか
    site_text = (ROOT / "data" / "site.js").read_text(encoding="utf-8")
    site = json.loads(site_text[site_text.index("{"):site_text.rindex("}") + 1])
    keys = ("id", "trait", "reverse", "text", "weight")
    same_q = [{k: q.get(k) for k in keys} for q in site["questions"]] == \
             [{k: q.get(k) for k in keys} for q in questions["questions"]]
    same_scale = site["scale"] == questions["scale"]
    same_codes = sorted(g["code"] for g in site["gods"]) == sorted(g["code"] for g in gods)
    print(f"サイトのデータと reference の一致: 質問・重み {same_q}, 尺度 {same_scale}, 32柱のコード {same_codes}")

    cases = make_cases(args.n, args.seed)
    browser = find_browser(args.browser)
    unweighted = {**questions, "questions": [{**q, "weight": 1} for q in questions["questions"]]}
    failures = []
    for label, qs, override in (("重みつき(サイトと同じ)", questions, None),
                                ("重みなし(同点の処理を試す)", unweighted, unweighted["questions"])):
        failures += compare(cases, python_results(cases, qs, gods), js_results(cases, browser, override), label)

    ok = not failures and same_q and same_scale and same_codes
    print("結果: 一致 (OK)" if ok else f"結果: 不一致 {len(failures)} 件 (NG)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
