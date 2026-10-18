"""元データ(.md・診断ロジック・楽曲メモ)から、サイト用の data/site.js を作る。

    .venv/Scripts/python tools/build_data.py [--src C:/Users/shous/claude-work]

読むもの(どれも書き換えない):
  <src>/seikaku_solvents_32.md            判定基準・溶媒メモ・神様キャラクター設定・最初の五柱のアイコン・神話
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


MYTH_ANCHOR = re.compile(r'^<a id="myth-(?P<id>[^"]+)"></a>\s*$')
MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
MYTH_NOTES = (("⚗ 化学の筋道", "chem"), ("✦ 夫婦神に選んだ理由", "reason"))


def table_rows(lines):
    """md の表の本文行をセルのリストで返す(見出し行と区切り行は除く)。"""
    rows = [[c.strip() for c in l.strip().strip("|").split("|")] for l in lines if l.startswith("|")]
    return [r for r in rows[1:] if not set("".join(r)) <= set("-: ")]


def parse_icons(lines):
    """「# 最初の五柱のアイコン」の表 → {神名: assets/icons/… のパス}(リポジトリ内に実在するものだけ)。"""
    out = {}
    for r in table_rows(lines):
        m = re.search(r"\]\((?:seikaku_solvents_site/)?([^)]+\.svg)\)", r[-1])
        if m and (ROOT / m[1]).exists():
            out[r[0]] = vurl(m[1])
    return out


def parse_myth(lines, icons):
    """「# 神話 ― 溶媒の神々の誕生」を、章・柱ごとの段落・注記・系譜表に分ける。
    <a id="myth-…"></a> の次の見出しを、章(## / ###)または柱(####、id は5桁のコード)として読む。"""
    myth = {"lead": [], "notice": "", "primordials": [], "chapters": [], "genealogy": []}
    lead = []
    state = {"pending": None, "chapter": None, "target": None, "skip": False}
    para, table = [], []

    def blocks():
        return state["target"]["blocks"] if state["target"] is not None else lead

    def flush():
        chapter = state["chapter"]
        if para:
            blocks().append({"t": "p", "text": "\n".join(para)})
            para.clear()
        if table:
            rows = table_rows(table)
            table.clear()
            if chapter and chapter["id"] == "ch1":
                myth["primordials"] = [{"name": r[0], "reading": r[1], "role": r[2], "icon": icons.get(r[0])} for r in rows]
                blocks().append({"t": "primordials"})
            elif rows and len(rows[0]) == 6:
                for name, solvent, code, kind, parents, chem in rows:
                    myth["genealogy"].append({"code": code, "kind": kind, "chem": chem,
                                              "parents": [p.strip() for p in parents.split("、") if p.strip()]})
                blocks().append({"t": "genealogy"})

    for raw in lines:
        line = raw.rstrip()
        if state["skip"]:  # 目次と mermaid の図は読み飛ばす
            if line.startswith("```") or line == "---":
                state["skip"] = False
            continue
        if line.startswith("```"):
            flush()
            state["skip"] = True
            continue
        m = MYTH_ANCHOR.match(line)
        if m:
            flush()
            state["pending"] = m["id"]
            if m["id"] == "toc":
                state["skip"] = True
            continue
        if line.startswith("#"):
            flush()
            level = len(line) - len(line.lstrip("#"))
            title = line.lstrip("#").strip()
            pending = state["pending"]
            if pending and re.fullmatch(r"[01]{5}", pending):
                state["target"] = {"t": "god", "code": pending, "blocks": []}
                state["chapter"]["blocks"].append(state["target"])
            elif pending:
                state["chapter"] = state["target"] = {"id": pending, "title": title, "level": level, "blocks": []}
                myth["chapters"].append(state["chapter"])
            state["pending"] = None
            continue
        if not line.strip() or line == "---":
            flush()
            continue
        if line.startswith("→ ") or line.startswith("[↑"):
            continue  # .md 内のリンク行(サイトでは各ページへのリンクを別に出す)
        if line.startswith("|"):
            if para:
                flush()
            table.append(line)
            continue
        if line.startswith("> "):
            flush()
            text = MD_LINK.sub(r"\1", line[2:].strip())
            for head, kind in MYTH_NOTES:
                if text.startswith(head):
                    blocks().append({"t": kind, "text": text[len(head):].lstrip(":: ")})
                    break
            else:
                if state["target"] is None:
                    myth["notice"] = text.lstrip("※ ")
                else:
                    blocks().append({"t": "p", "text": text})
            continue
        if line.startswith("- "):
            if para:
                flush()
            b = blocks()
            if not b or b[-1]["t"] != "list":
                b.append({"t": "list", "items": []})
            b[-1]["items"].append(MD_LINK.sub(r"\1", line[2:].strip()))
            continue
        para.append(MD_LINK.sub(r"\1", line.strip()))
    flush()
    myth["lead"] = [b["text"] for b in lead if b["t"] == "p"]
    return myth


def check_myth(myth, codes):
    """神話に32柱すべての項と系譜があるか確かめる。"""
    in_text = sorted(b["code"] for ch in myth["chapters"] for b in ch["blocks"] if b["t"] == "god")
    in_tree = sorted(g["code"] for g in myth["genealogy"])
    if in_text != codes or in_tree != codes:
        raise RuntimeError(f"神話の柱が揃っていない: 本文 {len(in_text)}・系譜 {len(in_tree)}")


def parse_music_axes(text):
    """32曲の README の「性格5軸の反映」の箇条 → [{"label": "外向性(揮発性)", "text": "..."}]。"""
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("- 性格5軸の反映"):
            inside = True
            continue
        if inside:
            m = re.match(r"^\s+- \*\*(.+?)\*\*:\s*(.+)$", line)
            if m:
                out.append({"label": m[1], "text": m[2].strip()})
            elif not line.startswith("  "):
                break
    return out


def parse_primordial_songs(text, icons, scores=None):
    """最初の五柱の曲の README → {"lead": [...], "common": "...", "songs": [...]}。"""
    lead, common, songs, cur = [], "", [], None
    for line in text.splitlines():
        m = re.match(r"^## (?P<name>[^(]+)\((?P<reading>[^)]+)\)\s*$", line)
        if m:
            cur = {"name": m["name"], "reading": m["reading"], "meta": "", "notes": [], "music": None,
                   "icon": icons.get(m["name"])}
            songs.append(cur)
            continue
        if cur is None:
            if line.startswith("- **ひと組としての共通点**"):
                common = strip_md(re.sub(r"^- \*\*ひと組としての共通点\*\*[:：]\s*", "", line)).strip()
            elif line.strip() and not line.startswith(("#", "-")):
                lead.append(line.strip())
            continue
        if line.startswith("[") and " — " in line:
            cur["meta"] = line.split(" — ", 1)[1].strip()
            m = re.match(r"^\[([a-z-]+)\.gaku\]", line)
            mp3 = f"assets/music/primordial/{m[1]}.mp3" if m else ""
            cur["music"] = vurl(mp3) if mp3 else None
            cur["score"] = (scores or {}).get(m[1]) if m else None
        elif line.startswith("- "):
            cur["notes"].append(strip_md(line[2:].strip()))
    return {"lead": lead, "common": common, "songs": songs}


def vurl(rel):
    """サイト内のファイルの URL に中身のハッシュを付ける(差し替えたら URL が変わり、古いキャッシュを読まない)。
    ファイルが無ければ None。"""
    if not rel:
        return None
    path = ROOT / rel.split("?")[0]
    if not path.exists():
        return None
    return f"{rel}?v={hashlib.sha1(path.read_bytes()).hexdigest()[:8]}"


SITE_HIDDEN_COMMON = ("見た目は若々しいが", "体の線を強調しない")
SCORE_PART = re.compile(r"^\[(?P<part>[^\]]+)\]\s*(?P<body>.*)$")


def parse_score(text):
    """整形済みの .gaku(gagaku.formatter の出力)→ 表で描ける形。
    1段 = 「# ---- n〜m小節」の見出し + 楽器ごとの行。行は | で小節に、小節は空白2つ以上で拍に分かれる
    (同じ拍の中の音は空白1つ)。全楽器で小節ごとの拍数がそろわない段は rows を None にして、原文で見せる。"""
    head, comments, systems, cur = {}, [], [], None
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            m = re.match(r"^#\s*-+\s*(.+小節)", s)
            if m:
                cur = {"label": m[1], "rows": [], "raw": []}
                systems.append(cur)
            elif cur is None:
                comments.append(s.lstrip("#").strip())
            continue
        m = SCORE_PART.match(s)
        if m and cur is not None:
            bars = [b.strip() for b in m["body"].split("|")]
            bars = [re.split(r"\s{2,}", b) for b in bars if b]
            cur["rows"].append({"part": m["part"], "bars": bars})
            cur["raw"].append(line.rstrip())
            continue
        if cur is None and ":" in s:
            k, v = s.split(":", 1)
            head[k.strip()] = v.strip()
    for sy in systems:
        shape = {tuple(len(b) for b in r["bars"]) for r in sy["rows"]}
        if len(shape) != 1:
            sy["rows"] = None
        else:
            sy.pop("raw")
    return {"head": head, "comments": comments, "systems": systems}


def build_scores(src_music, items):
    """items: [(id, .gaku のパス)] → data/scores/<id>.json と assets/scores/<id>.gaku を書き、
    {id: {"json": "...?v=", "gaku": "..."}} を返す。"""
    out_json, out_gaku = ROOT / "data" / "scores", ROOT / "assets" / "scores"
    out_json.mkdir(parents=True, exist_ok=True)
    out_gaku.mkdir(parents=True, exist_ok=True)
    found = {}
    for sid, path in items:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        body = json.dumps(parse_score(text), ensure_ascii=False, separators=(",", ":"))
        (out_json / f"{sid}.json").write_bytes(body.encode("utf-8"))
        shutil.copyfile(path, out_gaku / f"{sid}.gaku")
        digest = hashlib.sha1(body.encode("utf-8")).hexdigest()[:8]
        found[sid] = {"json": f"data/scores/{sid}.json?v={digest}", "gaku": f"assets/scores/{sid}.gaku"}
    return found


def strip_md(s):
    return re.sub(r"`([^`]+)`", r"\1", re.sub(r"\*\*(.+?)\*\*", r"\1", s))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    md_path = args.src / "seikaku_solvents_32.md"
    diag = args.src / "solvent_gods" / "diagnosis"
    music_readme = args.src / "solvent_gods" / "music" / "README.md"
    primordial_readme = args.src / "solvent_gods" / "music" / "primordial" / "README.md"

    sections = top_sections(md_path.read_text(encoding="utf-8"))
    list_lines = next(v for k, v in sections.items() if k.startswith("性格そるべんつ"))
    criteria, criteria_notes = parse_criteria(list_lines)
    solvent_notes = parse_solvent_notes(list_lines)
    intro, md_gods = parse_gods_md(sections["神様キャラクター設定"])
    songs = parse_songs(music_readme.read_text(encoding="utf-8")) if music_readme.exists() else {}
    icons = parse_icons(sections.get("最初の五柱のアイコン", []))
    myth_key = next((k for k in sections if k.startswith("神話")), None)
    myth = parse_myth(sections[myth_key], icons) if myth_key else None

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
            "image": vurl(image),
            "music": vurl(music),
        })
    # 楽譜(縦をそろえた譜面)。曲ごとに別ファイルにして、開いたときだけ読み込む
    music_dir = args.src / "solvent_gods" / "music"
    items = [(f'{g["code"]}_{g["slug"]}', music_dir / f'{g["code"]}_{g["slug"]}.gaku') for g in gods]
    if primordial_readme.exists():
        items += [(n, music_dir / "primordial" / f"{n}.gaku")
                  for n in re.findall(r"^\[([a-z-]+)\.gaku\]", primordial_readme.read_text(encoding="utf-8"), re.M)]
    scores = build_scores(music_dir, items)
    for g in gods:
        if g["song"] is not None:
            g["song"]["score"] = scores.get(f'{g["code"]}_{g["slug"]}')
    codes = sorted(g["code"] for g in gods)
    if codes != [format(i, "05b") for i in range(32)]:
        raise RuntimeError(f"32柱が揃っていない: {len(codes)}件")

    # 「共通の要件」のうち、絵姿を作るときの制作上の指示はサイトには出さない(.md には残す)
    music_page = json.loads((ROOT / "content" / "music_page.json").read_text(encoding="utf-8"))
    backgrounds = music_page.pop("primordial_backgrounds", {})
    intro["common"] = [c for c in intro["common"] if not c.startswith(SITE_HIDDEN_COMMON)]
    intro["common"] = [c.replace("離れ袖や肩の露出はなし。", "").strip() for c in intro["common"]]

    site = {
        "traits": questions["traits"],
        "scale": questions["scale"],
        "questions": [{k: q[k] for k in ("id", "trait", "reverse", "text", "weight") if k in q}
                      for q in questions["questions"]],
        "criteria": criteria,
        "criteria_notes": [strip_md(n) for n in criteria_notes],
        "character_intro": intro,
        "gods": gods,
        "myth": myth,
        "music_page": {
            **music_page,
            "axes": parse_music_axes(music_readme.read_text(encoding="utf-8")) if music_readme.exists() else [],
            "primordial": parse_primordial_songs(primordial_readme.read_text(encoding="utf-8"), icons, scores)
            if primordial_readme.exists() else None,
        },
    }
    if myth:
        check_myth(myth, codes)
    pr = site["music_page"]["primordial"]
    for song in (pr["songs"] if pr else []):
        bg = backgrounds.get(song["name"])
        song["background"] = vurl(bg)

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
    print(f"data/site.js: {len(gods)}柱・{len(site['questions'])}問 / 画像 {n_img}/32・楽曲 {n_mus}/32"
          + (f" / 神話 {len(myth['chapters'])}章・アイコン {len(icons)}/5" if myth else " / 神話なし"))


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
