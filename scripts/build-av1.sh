#!/usr/bin/env bash
# Rebuild the checked-in AV1 companion core. Requires Docker or Podman + git.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
engine=${CONTAINER_ENGINE:-docker}
work=$(mktemp -d)
container="joemt-av1-export-$$"
trap '"$engine" rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git "$work/source"
git -C "$work/source" checkout f876f907c7e9b9bf51d4ed0b913a855a63ae63fc
cp "$root/scripts/av1.Dockerfile" "$work/source/av1.Dockerfile"
"$engine" build -f "$work/source/av1.Dockerfile" -t joemt-av1 "$work/source"
"$engine" create --name "$container" joemt-av1 /unused
mkdir -p "$root/vendor/av1"
"$engine" cp "$container:/ffmpeg-core.js" "$root/vendor/av1/ffmpeg-core.js"
"$engine" cp "$container:/ffmpeg-core.wasm" "$root/vendor/av1/ffmpeg-core.wasm"
