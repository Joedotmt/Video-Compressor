# Third-party engines

The application ships the following components. All processing runs locally.

- **@ffmpeg/ffmpeg 0.12.15**, MIT, JavaScript worker API:
  https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.15/packages/ffmpeg
- **@ffmpeg/core and @ffmpeg/core-mt 0.12.10**, GPL-2.0-or-later, pinned in package-lock.json.
  Source and constituent-library build recipes:
  https://github.com/ffmpegwasm/ffmpeg.wasm
  Includes FFmpeg, x264, x265 and other libraries listed in its Dockerfile.
- **AV1 companion core**, compiled from FFmpeg n5.1.4 (LGPL-2.1-or-later),
  libaom v3.9.1 (BSD-2-Clause and Alliance for Open Media patent license), and
  FFmpeg.wasm bindings at commit `f876f907c7e9b9bf51d4ed0b913a855a63ae63fc` (MIT).
  Exact build instructions are in `scripts/av1.Dockerfile` and `scripts/build-av1.sh`.
  No GPL codecs are linked into this companion core.
  Sources: https://github.com/FFmpeg/FFmpeg/tree/n5.1.4,
  https://aomedia.googlesource.com/aom/+/refs/tags/v3.9.1/,
  https://github.com/ffmpegwasm/ffmpeg.wasm/tree/f876f907c7e9b9bf51d4ed0b913a855a63ae63fc.

The only JavaScript runtime modification is the explicit FFprobe return-value
patch in `scripts/prepare-engine.mjs`. The WASM binaries are unmodified build outputs.
License texts are included in `public/licenses/` and in the generated site.
