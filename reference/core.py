"""性格そるべんつ診断のロジック(標準ライブラリのみ)。

回答30個 → 5特性スコア(0〜1) → 32柱との距離 → 近い順に上位N柱と親和度。
内部は Fraction で計算するので、同点判定に浮動小数点の誤差が入らない。
"""
import hashlib
import json
import math
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIT_ORDER = ("E", "A", "O", "C", "N")  # コードの桁順: 外向性・協調性・開放性・誠実性・神経症傾向


def load_questions(path=HERE / "questions.json"):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_gods(path=HERE / "gods.json"):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _item_value(answer, reverse, lo=1, hi=4):
    """1問の得点(0〜1)。4段階なら通常は (回答-1)/3、逆転項目は (4-回答)/3。"""
    if isinstance(answer, bool) or not isinstance(answer, int) or not lo <= answer <= hi:
        raise ValueError(f"回答は{lo}〜{hi}の整数: {answer!r}")
    return Fraction(hi - answer, hi - lo) if reverse else Fraction(answer - lo, hi - lo)


def item_weight(question):
    """質問の重み(既定1)。JSONの小数を文字列経由で Fraction にして、誤差なく扱う。"""
    return Fraction(str(question.get("weight", 1)))


def score_traits(answers, questions):
    """回答リスト(questions の順)→ {特性キー: Fraction(0〜1)}。各特性は6問の重み付き平均。"""
    qs = questions["questions"]
    lo, hi = questions["scale"]["min"], questions["scale"]["max"]
    if len(answers) != len(qs):
        raise ValueError(f"回答数は{len(qs)}個必要(受け取ったのは{len(answers)}個)")
    num = {k: Fraction(0) for k in TRAIT_ORDER}
    den = {k: Fraction(0) for k in TRAIT_ORDER}
    for q, a in zip(qs, answers):
        w = item_weight(q)
        num[q["trait"]] += w * _item_value(a, q["reverse"], lo, hi)
        den[q["trait"]] += w
    return {k: num[k] / den[k] for k in TRAIT_ORDER}


def god_vector(code):
    return tuple(int(c) for c in code)


def squared_distance(user, code):
    """Σ(ユーザー値 − 神の値)^2。user は TRAIT_ORDER 順の値の並び。"""
    return sum((Fraction(u) - g) ** 2 for u, g in zip(user, god_vector(code)))


def affinity_from_distance(distance, n_axes=len(TRAIT_ORDER)):
    """RMS誤差 = sqrt(距離/5)。値域0〜1なので 誤差率(%) = RMS×100、親和度(%) = 100 − |誤差率|。"""
    rms = math.sqrt(float(distance) / n_axes)
    error_pct = rms * 100
    return rms, error_pct, 100 - abs(error_pct)


def tie_key(seed, code):
    """同点の並び順に使うキー。回答(seed)とコードの SHA-256。

    同じ回答なら毎回同じ順、回答が変われば順も入れ替わるので、特定のコードが
    常に先に来る偏り(旧仕様の「コード昇順」で0側が有利になっていた問題)が出ない。
    """
    return hashlib.sha256(f"{seed}|{code}".encode("utf-8")).hexdigest()


def rank_gods(user, gods, top_n=5, seed=""):
    """距離の昇順に上位 top_n 柱を返す。

    距離が等しい柱は同じ順位(1, 1, 3, …のように数える)とし、表示順は tie_key で決める。
    top_n 番目で同点が切れる場合も、tie_key の順で top_n 柱ちょうどに切る。
    """
    scored = sorted(((squared_distance(user, g["code"]), g) for g in gods),
                    key=lambda dg: (dg[0], tie_key(seed, dg[1]["code"])))
    dists = [d for d, _ in scored]
    result = []
    for d, g in scored[:top_n]:
        rms, err, aff = affinity_from_distance(d)
        result.append({"rank": 1 + sum(x < d for x in dists), "tied": dists.count(d) > 1,
                       **g, "distance": float(d), "rms_error": rms,
                       "error_pct": err, "affinity_pct": aff})
    return result


def diagnose(answers, questions=None, gods=None, top_n=5):
    """回答リスト → 結果dict(純粋関数。questions/gods 省略時は同梱JSONを読む)。"""
    questions = questions or load_questions()
    gods = gods or load_gods()
    traits = score_traits(answers, questions)
    user = tuple(traits[k] for k in TRAIT_ORDER)
    names = {t["key"]: t for t in questions["traits"]}
    return {
        "scores": [{"key": k, "name": names[k]["name"], "solvent_property": names[k]["solvent_property"],
                    "value": float(traits[k])} for k in TRAIT_ORDER],
        "ranking": rank_gods(user, gods, top_n, seed=",".join(map(str, answers))),
    }
