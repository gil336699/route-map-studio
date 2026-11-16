#!/usr/bin/env bash
# Compares every file of a local production build with the copy on the live site, by SHA-256.
# Usage: check-live.sh <live url ending in /> <dist dir>
#   e.g. check-live.sh https://gil336699.github.io/line-growth/ dist
# Exits non-zero if any file is missing or differs. GitHub Pages can take a minute or two to update after the
# Pages workflow finishes, so retry before calling it a failure.
set -euo pipefail
url=$1 dist=$2 bad=0 n=0
cd "$dist"
while IFS= read -r rel; do
  n=$((n + 1))
  here=$(shasum -a 256 "$rel" | cut -d' ' -f1)
  if ! live=$(curl -fsSL "$url$rel" | shasum -a 256 | cut -d' ' -f1); then
    echo "missing  $rel"; bad=$((bad + 1)); continue
  fi
  if [ "$live" = "$here" ]; then echo "same     $rel"; else echo "differs  $rel"; bad=$((bad + 1)); fi
done < <(find . -type f ! -name '.DS_Store' | sed 's|^\./||' | sort)
echo "$((n - bad)) of $n files match the live site"
[ "$bad" -eq 0 ]
