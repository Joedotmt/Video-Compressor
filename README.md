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

## Trim & Crop

Open a video and select the **Trim & Crop** tab. Compression settings and edits
share the same export; the original file is never modified. The tabs, video chooser,
and **Export** button share the application header.

- Seek by clicking or dragging the timeline ruler, dragging its playhead, or
  entering an exact playhead time. Clicking the track or a segment never seeks.
- **I** places an In point and **O** places an Out point, independently of the
  selected segment. Points are paired in time order: a leading Out starts at
  source time zero, and a trailing In runs to the source end. For example, Out
  at frame 50, In at 100, Out at 150 and In at 200 produce 0–50, 100–150 and
  200–end.
- Repeating **I** or **O** moves the nearby point of the same type to the playhead,
  instead of leaving an extra point. For example, I at frame 10, O at 20, then
  O at 30 produces 10–30. An opposite point between the marks separates them:
  I after an Out or O before an In still creates another segment.
- Select a segment to edit its exact In/Out timecodes or delete it in the
  inspector. Dragging a boundary uses your initial grab offset and does not
  move the playhead. The inspector also contains the **Keep/Remove** setting
  for all marked segments and the kept-segments preview option. No points means
  the whole video. Segments export in source order, with overlaps merged.
- **B** splits a segment; **Delete** deletes the selected segment. **Space** plays
  or pauses, arrows seek, and comma/period step by nominal frame duration. Time
  fields accept seconds or `HH:MM:SS.mmm`. Shortcuts do not interrupt text entry.
- The crop rectangle is always visible, starting with the full frame. Move it or
  drag its edges/corners. Reset restores the full frame. Use
  Free, Original, square, landscape or portrait aspect ratios, or enter exact
  **X, Y, Width, Height** in original-video pixels (arithmetic is supported).
  Exact dimension edits switch to Free. Arrow keys move the focused crop or its
  handles by one pixel; Shift moves ten.
- Drag a segment's body to move both boundaries together. Its duration stays
  fixed, and it stops at neighboring segments or the start/end of the source.
- The scrollbar below the timeline doubles as a zoom control: drag its middle
  to pan and either end to resize the visible time range. Double-click it or
  press **\** to fit. **= / +**, **−**, and **Alt + wheel** also zoom.
  Middle-drag or scroll horizontally to pan. A fixed shaded gutter sits to the
  left of zero; panning cannot expose negative time.
- The preview has independent zoom and pan: wheel to zoom around the pointer,
  **Space-drag**, middle-drag, or **Hand (H)** to pan, and **Z** to fit the whole
  video. **Crop (V)** returns to editing the rectangle. Enter a magnification
  between 1% and 6400%, or use the +/− buttons. Changing the crop never moves
  the view, and changing the view never affects exported pixels.
- On mobile, pinch to zoom and pan the preview, use Hand for one-finger panning,
  and drag the timeline scrollbar ends to zoom. Drag the playhead or use the
  seek slider to scrub. The inspector collapses below the timeline on narrow
  screens. Desktop editing fills the window, with scrolling confined to the
  inspector or status area when necessary.
- Output dimensions follow the crop until you manually edit the resize settings.
  Video Reset uses the current crop dimensions. The target-size budget uses the
  total kept duration, adjusted for playback speed.
- If the browser cannot play the source, **Create Compatible Preview** makes a
  local low-resolution H.264 preview; exports still use the original file.

All exports are re-encoded, including trim-only edits; this is not lossless stream
copying. Preview seeking/frame stepping depends on browser support and the source
frame rate. The exported cuts are applied by FFmpeg. Edits are kept for the current
file only and reset when another video is opened or the page is reloaded.

Interaction references: [LosslessCut's segment editing](https://github.com/mifi/lossless-cut/blob/master/docs/getting-started.md)
and [Google Photos cropping](https://support.google.com/photos/answer/10729480).

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
Additional tests cover edit geometry, time ranges, keyboard shortcuts, tab state, and export integration.
Edited WASM exports are checked against an independent native reference for frame content.
The worker test also verifies cancellation, discarded partial output and retry.
These are engine integration tests; it does not replace a visual browser/UI test.

## Source layout

- `web/app.js`: interface, file selection, state, progress, cancellation and downloads.
- `web/engine.js`: browser-worker FFmpeg loading and read-only file mounts.
- `web/editor.js` and `web/edits.js`: crop geometry, multi-segment editing, preview and keyboard controls.
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
