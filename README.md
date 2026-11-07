<div align="center">
  <img src="data/icons/io.github.Joedotmt.JoemtVideoCompressor.svg" alt="Joemt Video Compressor" width="96" />
</div>

# Joemt Video Compressor — browser edition

A static, private video compressor built with vanilla HTML, CSS and JavaScript.
Videos are read and compressed entirely on your device using FFmpeg WebAssembly
in a background worker. No video uploads, accounts, API keys or backend.

## Run locally

Requires Node.js 22 or newer for development (visitors need only a modern browser).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To build and serve the production version:

```sh
npm run build
npm run preview
```

`dist/` is the complete static website, including both locally served engines.
Serve it over HTTP(S), not by opening `index.html` as a file. Relative asset paths
support both a GitHub Pages project subdirectory and a custom domain.

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Run **Browser app · GitHub Pages** from the Actions tab, or push to `main`.

The included workflow tests the calculations, builds the app, verifies actual
WebAssembly encodes for all three codecs, and deploys `dist/`. Pull requests build
and test without deploying. A small same-origin service worker adds isolation headers locally for threaded
HEVC encoding. The page reloads once on first use, before file selection is enabled.
GitHub Pages itself needs no custom header configuration. H.264 and AV1 use
single-threaded engines.

## Features

- Drop a video, browse, or press Ctrl/Cmd+O.
- Probe duration, dimensions, frame rate, size and audio tracks using FFprobe.
- Target an approximate file size using the desktop app's 97% bitrate safety margin.
- Enter arithmetic (`1920/2`, `25*2`) in numeric settings.
- Resize, change frame rate, retain/mute audio and set audio bitrate.
- Change playback speed with pitch-preserving audio tempo filters.
- Encode H.264, H.265/HEVC, or AV1 to MP4, with encoding presets and valid codec-specific tuning.
- Reset target size, video settings and audio bitrate to source values.
- See progress, cancel without saving partial output, retry and download with a custom filename.
- Single-column GTK-style layout, native browser controls, keyboard shortcuts and diagnostic logs.

The original Python/GTK implementation remains available. See [desktop setup](docs/DESKTOP.md).

## Browser differences

- Encoding is CPU-based and slower than native FFmpeg; AV1 can be particularly slow.
- Engines download on demand from the same host: approximately 31 MB for probing/H.264,
  plus 32 MB for the first HEVC encode or 19 MB for the first AV1 encode. No runtime CDN dependencies.
- Inputs are mounted read-only through WORKERFS, avoiding a full input copy into WASM memory.
  Output and encoder buffers still consume memory. Files at or above 2 GiB are rejected;
  the practical limit can be much lower on mobile or memory-constrained devices.
- HEVC needs SharedArrayBuffer and working service workers over HTTPS (or localhost),
  and its threaded engine reserves about 1 GiB of memory. H.264/AV1 remain usable
  when isolation is unavailable.
- Keep the tab open. A browser can suspend background tabs or exhaust memory.
- Target size is approximate, not a guaranteed hard cap. Tiny/short clips may exceed it.
- Dimensions are rounded down to even pixels, as in the desktop interface.
- Only the first video and audio tracks are encoded. Output is MP4.
- Browsers control the download destination instead of a native save-path chooser.
- The engine is released after probing, success, failure or cancellation.

## Tests

```sh
npm test
npm run build
# Requires native ffmpeg/ffprobe only to generate and inspect test fixtures:
node scripts/smoke-engines.mjs
node scripts/smoke-worker.mjs
python3 -m unittest discover -v
```

The smoke test performs actual WASM encodes for H.264, HEVC and AV1, then verifies
codec, dimensions, audio presence, frame rate and speed-adjusted duration.
The worker test also verifies cancellation, discarded partial output and retry.
These are engine integration tests; it does not replace a visual browser/UI test.

## Source layout

- `web/app.js`: interface, file selection, state, progress, cancellation and downloads.
- `web/engine.js`: browser-worker FFmpeg loading and read-only file mounts.
- `web/compressor.js`: safe expressions, metadata, validation and command planning.
- `scripts/prepare-engine.mjs`: copy pinned engines and fix upstream FFprobe return handling.
- `vendor/av1/`: prebuilt, reproducible AV1 companion engine (standard FFmpeg.wasm omits AV1 encoding).
- `scripts/av1.Dockerfile`, `scripts/build-av1.sh`: AV1 engine source/build recipe.
- `.github/workflows/pages.yml`: static build, codec tests and Pages deployment.

To rebuild AV1 locally, run `bash scripts/build-av1.sh` with Docker installed,
or `CONTAINER_ENGINE=podman bash scripts/build-av1.sh`. Normal app builds use the
checked-in engine and do not need containers. See [third-party notices](THIRD_PARTY.md).

## License

GNU General Public License v3.0. Third-party engine components retain their own licenses.
