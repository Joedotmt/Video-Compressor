// Exercise the real @ffmpeg/ffmpeg worker protocol and cancellation in Node.
// Only browser platform APIs (location/fetch/Worker) are shimmed; encoder and
// application-facing API are the exact modules shipped in the static site.
import Worker from 'web-worker';
import assert from 'node:assert/strict';
import { FFmpeg } from '../node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js';
const live = new Set();
globalThis.Worker = class extends Worker {
  constructor(url) {
    const source = `import { readFile } from 'node:fs/promises';
      self.location = { href: ${JSON.stringify(String(url))} };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, options) => String(input).startsWith('file:')
        ? new Response(await readFile(new URL(input)), {headers:{'Content-Type':'application/wasm'}})
        : originalFetch(input, options);
      await import(${JSON.stringify(String(url))});`;
    super(new URL('data:text/javascript,' + encodeURIComponent(source)), { type: 'module' });
    live.add(this);
  }
  terminate() { live.delete(this); return super.terminate(); }
};
const base = new URL('../public/engine/', import.meta.url);
const urls = { coreURL: new URL('ffmpeg-core.js', base).href, wasmURL: new URL('ffmpeg-core.wasm', base).href };
try {
  let f = new FFmpeg();
  await f.load(urls);
  // An intentionally long generated input guarantees cancellation occurs mid-job.
  const pending = f.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '3600', '-c:v', 'libx264', '-preset', 'slow', 'cancel.mp4']);
  const rejected = assert.rejects(pending, /terminate/);
  setTimeout(() => f.terminate(), 100);
  await rejected;
  f = new FFmpeg(); await f.load(urls);
  assert.equal(await f.exec(['-f', 'lavfi', '-i', 'color=size=64x64:rate=10', '-t', '0.2', '-c:v', 'libx264', '-preset', 'ultrafast', 'retry.mp4']), 0);
  assert.ok((await f.readFile('retry.mp4')).length > 0);
  assert.equal((await f.listDir('/')).some(entry => entry.name === 'cancel.mp4'), false);
  f.terminate();
  console.log('Worker API: cancellation rejects promptly, partial output is discarded, and a fresh worker successfully encodes.');
} finally { for (const worker of live) worker.terminate(); }
