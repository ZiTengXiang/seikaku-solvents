"""「まことの御姿」(solvent_gods/true_forms/render.py が moleditpy の CPK 表示で描いた PNG 1200×1754)を、
サイト用の WebP(幅600px)に縮小する。

    .venv/Scripts/python tools/convert_true_forms.py [--src C:/Users/shous/claude-work] [--force]

<src>/solvent_gods/true_forms/<コード>_<slug>.png → assets/images/true/<コード>_<slug>.webp。
変換済みで元より新しいものは飛ばす。最後に tools/build_data.py を呼ぶ。
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WIDTH = 600
NAME = re.compile(r"^[01]{5}_[a-z0-9_]+\.png$")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=ROOT.parent)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    src_dir = args.src / "solvent_gods" / "true_forms"
    out_dir = ROOT / "assets" / "images" / "true"
    out_dir.mkdir(parents=True, exist_ok=True)
    done = 0
    for png in sorted(src_dir.glob("*.png")):
        if not NAME.match(png.name):
            continue
        out = out_dir / (png.stem + ".webp")
        if not args.force and out.exists() and out.stat().st_mtime >= png.stat().st_mtime:
            continue
        with Image.open(png) as im:
            im = im.convert("RGB")
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
            im.save(out, "WEBP", quality=82, method=6)
        done += 1
        print(f"{png.name} -> {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
    print(f"変換 {done} 枚")
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_data.py"), "--src", str(args.src)], check=True)


if __name__ == "__main__":
    main()
