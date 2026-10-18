"""楽曲(WAV 44.1kHz/16bit/ステレオ)を、サイト用の MP3 に圧縮する。

    .venv/Scripts/python tools/convert_music.py [--src C:/Users/shous/claude-work] [--force]

<src>/solvent_gods/music/<コード>_<slug>.wav を1曲ずつ読み、assets/music/<コード>_<slug>.mp3 に書く。
最初の五柱の曲 <src>/solvent_gods/music/primordial/<名前>.wav は assets/music/primordial/<名前>.mp3 に書く。
MP3 にしたのは iPhone の Safari を含めてどのブラウザでも再生できるため(libsndfile の LAME を
soundfile 経由で使う。ffmpeg は要らない)。可変ビットレート(compression_level 0.6、約100kbps)で 1分あたり約0.75MB。
変換済みで元より新しいものは飛ばす。最後に tools/build_data.py を呼ぶ。
"""
import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
NAME = re.compile(r"^[01]{5}_[a-z0-9_]+\.wav$")
PRIMORDIAL = re.compile(r"^[a-z][a-z-]+\.wav$")
QUALITY = 0.6  # soundfile の compression_level(0=最高品質 … 1=最小)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=ROOT.parent)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--pause", type=float, default=1.0, help="1曲ごとに休む秒数(CPUを譲る)")
    args = ap.parse_args()
    src_dir = args.src / "solvent_gods" / "music"
    out_dir = ROOT / "assets" / "music"
    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    # 32柱のテーマ曲(<コード>_<slug>.wav)と、最初の五柱の曲(primordial/<名前>.wav)
    jobs = [(w, out_dir / (w.stem + ".mp3")) for w in sorted(src_dir.glob("*.wav")) if NAME.match(w.name)]
    (out_dir / "primordial").mkdir(exist_ok=True)
    jobs += [(w, out_dir / "primordial" / (w.stem + ".mp3")) for w in sorted((src_dir / "primordial").glob("*.wav"))
             if PRIMORDIAL.match(w.name)]
    for wav, out in jobs:
        if not args.force and out.exists() and out.stat().st_mtime >= wav.stat().st_mtime:
            total += out.stat().st_size
            continue
        data, rate = sf.read(wav, dtype="float32")
        sf.write(out, data, rate, format="MP3", subtype="MPEG_LAYER_III",
                 bitrate_mode="VARIABLE", compression_level=QUALITY)
        size = out.stat().st_size
        total += size
        print(f"{wav.name} -> {out.relative_to(ROOT)} ({size / 1e6:.2f} MB, {len(data) / rate:.0f}秒)", flush=True)
        time.sleep(args.pause)
    print(f"合計 {total / 1e6:.1f} MB")
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_data.py"), "--src", str(args.src)], check=True)


if __name__ == "__main__":
    main()
