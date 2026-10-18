#!/bin/bash
# 指定した絵姿だけをサイトに載せて公開する。
#   bash tools/publish_images.sh "コミットの見出し" 00001_formic_acid [00000_cumene ...]
# convert_images.py は未変換の画像をすべて WebP にするので、指定外(作り直し待ちの画像など)は消してから
# データを作り直し、指定した画像とデータだけをコミットして push する。
set -e
cd "$(dirname "$0")/.."
title="$1"; shift
.venv/Scripts/python.exe tools/convert_images.py > /dev/null
# 対象は 32柱の絵姿(<コード>_<slug>.webp)だけ。サブフォルダ(最初の五柱の背景など)には触らない
for f in $(git status --porcelain --untracked-files=all assets/images | awk '{print $2}' | grep -E '^assets/images/[01]{5}_[a-z0-9_]+\.webp$'); do
  keep=""
  for id in "$@"; do [ "$f" = "assets/images/$id.webp" ] && keep=1; done
  [ -n "$keep" ] || rm -f "$f"
done
.venv/Scripts/python.exe tools/build_data.py > /dev/null
files=()
for id in "$@"; do files+=("assets/images/$id.webp"); done
printf '%s\n' "$title" "" "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" > /tmp/publish_msg.txt
git add "${files[@]}" data/site.js index.html
git commit -q -F /tmp/publish_msg.txt
git push -q
c=$(git rev-parse --short HEAD)
for i in $(seq 1 30); do
  s=$("/c/Program Files/GitHub CLI/gh.exe" api repos/ZiTengXiang/seikaku-solvents/pages/builds/latest --jq '.status+" "+.commit' 2>/dev/null || true)
  case "$s" in built\ $c*) break;; esac
  sleep 15
done
echo "commit $c / pages: $s"
for id in "$@"; do
  curl -s -o /dev/null -w "$id %{http_code}\n" "https://zitengxiang.github.io/seikaku-solvents/assets/images/$id.webp"
done
