"""元データ(.md・診断ロジック・楽曲メモ)から、サイト用の data/site.js を作る。

    .venv/Scripts/python tools/build_data.py [--src C:/Users/shous/claude-work]

読むもの(どれも書き換えない):
  <src>/seikaku_solvents_32.md            判定基準・溶媒メモ・神様キャラクター設定
  <src>/solvent_gods/diagnosis/           questions.json / gods.json / core.py
  <src>/solvent_gods/music/README.md      曲名・調子・テンポ・曲の狙い
  content/kotoyosashi.json(このリポジトリ内) 各柱の言寄さし(神からの助言のセリフ)
書くもの:
  data/site.js        サイトが読むデータ(window.SITE_DATA = {...})
  reference/          Python版ロジックの写し(core.py, questions.json, gods.json)。テスト用
画像・楽曲は assets/ に変換済みのものがあれば、そのパスを入れる(無ければ null)。
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT.parent  # C:/Users/shous/claude-work
TRAITS = ("E", "A", "O", "C", "N")
AXIS_LABEL = re.compile(r"^(外向性|協調性|開放性|誠実性|神経症傾向) \((.+?)\): ([01])( ⚠)?\s*$")
GOD_HEADING = re.compile(r"^### (?P<solvent>.+?) ― (?P<god>[^(]+)\((?P<reading>[^)]+)\)\s*$")
CODE_LINE = re.compile(r"^コード (?P<code>[01]{5}) / (?P<gender>女神|男神)")
PROFILE_LINE = re.compile(r"^- \*\*(?P<key>[^*]+)\*\*[:：](?P<val>.+)$")
SONG_HEADING = re.compile(r"^### (?P<code>[01]{5}) (?P<god>\S+) ― (?P<title>.+?)\s*$")
PROFILE_KEYS = {"性格": "personality", "外見": "appearance", "装束": "attire", "装飾品・持ち物": "accessories"}


def top_sections(text):
    """'# 見出し' ごとに本文を分ける。"""
    out, name, buf = {}, "", []
    for line in text.splitlines():
        if line.startswith("# "):
            out[name] = buf
            name, buf = line[2:].strip(), []
        else:
            buf.append(line)
    out[name] = buf
    return out


def parse_criteria(lines):
    """判定基準の表と注記。"""
    rows, notes, in_crit = [], [], False
    for line in lines:
        if line.startswith("## "):
            in_crit = line.strip() == "## 判定基準"
            continue
        if line.startswith("### "):
            in_crit = False
        if not in_crit:
            continue
        if line.startswith("|") and not line.startswith("|---"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells[0] != "ビッグファイブ":
                rows.append(dict(zip(("trait", "property", "one", "zero"), cells)))
        elif line.startswith("- "):
            notes.append(line[2:].strip())
    return rows, notes


def parse_solvent_notes(lines):
    """溶媒一覧(### 溶媒名 → 5軸と ⚠、> 説明)。溶媒名をキーに返す。"""
    out, cur = {}, None
    for line in lines:
        if line.startswith("### "):
            cur = {"axes": [], "borderline": [], "note": ""}
            out[line[4:].strip()] = cur
            continue
        if cur is None:
            continue
        m = AXIS_LABEL.match(line)
        if m:
            cur["axes"].append(int(m[3]))
            cur["borderline"].append(bool(m[4]))
        elif line.startswith("> "):
            cur["note"] = line[2:].strip()
    return {k: v for k, v in out.items() if len(v["axes"]) == 5}


def parse_gods_md(lines):
    """神様キャラクター設定(共通要件・5軸の読み替え・各柱のプロフィール)。"""
    intro, gods, cur, section = {"lead": "", "common": [], "axes": []}, [], None, None
    for line in lines:
        m = GOD_HEADING.match(line)
        if m:
            cur = {**{k: v.strip() for k, v in m.groupdict().items()}, "profile": {}}
            gods.append(cur)
            continue
        if cur is None:
            if line.startswith("**共通の要件**"):
                section = "common"
            elif line.startswith("**性格5軸の読み替え**"):
                section = "axes"
            elif line.startswith("- ") and section:
                intro[section].append(line[2:].strip())
            elif line.strip() and not line.startswith(("---", "#")) and not intro["lead"]:
                intro["lead"] = line.strip()
            continue
        m = CODE_LINE.match(line)
        if m:
            cur.update(m.groupdict())
            continue
        m = PROFILE_LINE.match(line)
        if m and m["key"] in PROFILE_KEYS:
            cur["profile"][PROFILE_KEYS[m["key"]]] = m["val"].strip()
    return intro, gods


def parse_songs(text):
    songs, cur = {}, None
    for line in text.splitlines():
        m = SONG_HEADING.match(line)
        if m:
            cur = {"title": m["title"], "meta": "", "notes": []}
            songs[m["code"]] = cur
            continue
        if cur is None:
            continue
        if line.startswith("### ") or line.startswith("## "):
            cur = None
        elif line.startswith("[") and " — " in line:
            cur["meta"] = line.split(" — ", 1)[1].strip()
        elif line.startswith("- "):
            cur["notes"].append(line[2:].strip())
    return songs


def strip_md(s):
    return re.sub(r"\*\*(.+?)\*\*", r"\1", s)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    md_path = args.src / "seikaku_solvents_32.md"
    diag = args.src / "solvent_gods" / "diagnosis"
    music_readme = args.src / "solvent_gods" / "music" / "README.md"

    sections = top_sections(md_path.read_text(encoding="utf-8"))
    list_lines = next(v for k, v in sections.items() if k.startswith("性格そるべんつ"))
    criteria, criteria_notes = parse_criteria(list_lines)
    solvent_notes = parse_solvent_notes(list_lines)
    intro, md_gods = parse_gods_md(sections["神様キャラクター設定"])
    songs = parse_songs(music_readme.read_text(encoding="utf-8")) if music_readme.exists() else {}

    questions = json.loads((diag / "questions.json").read_text(encoding="utf-8"))
    kotoyosashi = json.loads((ROOT / "content" / "kotoyosashi.json").read_text(encoding="utf-8"))
    # 古典曲と同じ名前の曲には「別の新作である」旨の注記を付ける
    classical = json.loads((ROOT / "content" / "classical_titles.json").read_text(encoding="utf-8"))
    for song in songs.values():
        if song["title"] in classical:
            song["classical_note"] = classical[song["title"]]
    diag_gods = {g["code"]: g for g in json.loads((diag / "gods.json").read_text(encoding="utf-8"))}

    notes_by_code = {"".join(map(str, v["axes"])): {**v, "name": k} for k, v in solvent_notes.items()}
    gods = []
    for g in md_gods:
        code = g["code"]
        slug = diag_gods[code]["slug"]
        # 溶媒一覧と神様設定で溶媒の書き方(略称の有無)が違うことがあるので、コードで突き合わせる
        note = notes_by_code.get(code)
        if note is None:
            raise RuntimeError(f"溶媒一覧に {code} ({g['solvent']}) が無い")
        image = f"assets/images/{code}_{slug}.webp"
        music = f"assets/music/{code}_{slug}.mp3"
        gods.append({
            "code": code, "slug": slug, "solvent": g["solvent"], "god": g["god"], "reading": g["reading"],
            "gender": g["gender"], "solvent_full": note["name"], "borderline": note["borderline"], "solvent_note": note["note"],
            "profile": g["profile"], "song": songs.get(code),
            "kotoyosashi": kotoyosashi.get(code, ""),
            "image": image if (ROOT / image).exists() else None,
            "music": music if (ROOT / music).exists() else None,
        })
    codes = sorted(g["code"] for g in gods)
    if codes != [format(i, "05b") for i in range(32)]:
        raise RuntimeError(f"32柱が揃っていない: {len(codes)}件")

    site = {
        "traits": questions["traits"],
        "scale": questions["scale"],
        "questions": [{k: q[k] for k in ("id", "trait", "reverse", "text", "weight") if k in q}
                      for q in questions["questions"]],
        "criteria": criteria,
        "criteria_notes": [strip_md(n) for n in criteria_notes],
        "character_intro": intro,
        "gods": gods,
    }
    (ROOT / "data").mkdir(exist_ok=True)
    body = json.dumps(site, ensure_ascii=False, indent=1)
    (ROOT / "data" / "site.js").write_text(
        "// tools/build_data.py が生成。手で編集しない。\nwindow.SITE_DATA = " + body + ";\n", encoding="utf-8")

    ref = ROOT / "reference"
    ref.mkdir(exist_ok=True)
    for name in ("core.py", "questions.json", "gods.json"):
        shutil.copyfile(diag / name, ref / name)

    stamp_index()

    n_img = sum(g["image"] is not None for g in gods)
    n_mus = sum(g["music"] is not None for g in gods)
    print(f"data/site.js: {len(gods)}柱・{len(site['questions'])}問 / 画像 {n_img}/32・楽曲 {n_mus}/32")


def stamp_index():
    """index.html が読む CSS・JS・データの ?v= を中身のハッシュにする。
    GitHub Pages はキャッシュが効くので、中身が変わったら URL も変えて古いものを読ませない。"""
    index = ROOT / "index.html"
    html = index.read_bytes().decode("utf-8")  # 改行コードを変えないようバイトで読み書きする
    for rel in ("css/style.css", "data/site.js", "js/diagnosis.js", "js/app.js"):
        digest = hashlib.sha1((ROOT / rel).read_bytes()).hexdigest()[:8]
        html = re.sub(re.escape(rel) + r"\?v=[0-9a-zA-Z]+", f"{rel}?v={digest}", html)
    index.write_bytes(html.encode("utf-8"))


if __name__ == "__main__":
    main()
