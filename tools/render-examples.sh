#!/usr/bin/env bash
# Render every example's title screen with the headless WebGPU harness.
#   tools/render-examples.sh [tier] [width] [height]
set -euo pipefail
cd "$(dirname "$0")/.."
tier=${1:-medium}; w=${2:-800}; h=${3:-450}
mkdir -p test-output/examples
for name in $(node -e "console.log(require('./examples/index.json').join(' '))"); do
  echo "== $name"
  node tools/shot.mjs "play/index.html?example=$name&tier=$tier&scale=1&dpr=1" "test-output/examples/$name.png" 6 "$w" "$h" | grep -E '"errors"|\]|ms' | tr -d '\n'; echo
done
