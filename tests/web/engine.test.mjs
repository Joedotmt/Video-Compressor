import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Exercise engine orchestration without fetching WASM; real codec coverage lives
// in scripts/smoke-av1-input.mjs.
const code = readFileSync('web/engine.js', 'utf8')
  .replace("import { FFmpeg } from '@ffmpeg/ffmpeg';", 'class FFmpeg {}')
  .replace("'./compressor.js'", JSON.stringify(pathToFileURL(resolve('web/compressor.js')).href));
const { BrowserCompressor } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const job = { inputCodec: 'av1', codec: 'libx264', width: 64, height: 48, fps: 12, speed: 1, audio: true, duration: 2, videoBps: 100000, audioBps: 64000, preset: 'ultrafast' };
const file = new File(['fixture'], 'source.webm');
function runner() {
  const engine = new BrowserCompressor(() => {}, () => {}), loaded = [], mounted = [];
  engine.load = async (codec = 'libx264') => {
    engine.checkCancelled();
    const core = { codec, commands: [], terminated: false,
      exec: async args => { core.commands.push(args); return 0; },
      readFile: async () => new Uint8Array([1, 2, 3]),
      terminate: () => { core.terminated = true; }
    };
    loaded.push(core); engine.ffmpeg = core; return core;
  };
  engine.mount = async (_, input) => { mounted.push(input); return `/input/${input.name}`; };
  return { engine, loaded, mounted };
}
test('AV1 to H.264 uses a lossless bridge and releases each worker', async () => {
  const { engine, loaded, mounted } = runner();
  const result = await engine.compress(file, job);
  assert.equal(result.type, 'video/mp4'); assert.equal(result.size, 3);
  assert.deepEqual(loaded.map(core => core.codec), ['libaom-av1', 'libx264']);
  assert.equal(mounted[0], file); assert.equal(mounted[1].name, 'decoded.mkv');
  assert.ok(loaded[0].commands[0].includes('ffv1'));
  assert.ok(!loaded[1].commands[0].includes('libaom-av1'));
  assert.ok(loaded.every(core => core.terminated)); assert.equal(engine.ffmpeg, null);
});
test('AV1 output decodes directly; other input codecs keep the existing path', async () => {
  for (const options of [{ ...job, codec: 'libaom-av1', preset: '6' }, { ...job, inputCodec: 'h264' }]) {
    const { engine, loaded, mounted } = runner();
    await engine.compress(file, options);
    assert.equal(loaded.length, 1); assert.equal(mounted[0], file);
    assert.equal(loaded[0].codec, options.codec);
    assert.equal(loaded[0].commands[0].includes('ffv1'), false);
  }
});
test('AV1 compatible previews use the software decoder bridge', async () => {
  const { engine, loaded, mounted } = runner();
  await engine.preview(file, { videoCodec: 'av1', width: 608, height: 1080, fps: 30, duration: 34, audio: true });
  assert.deepEqual(loaded.map(core => core.codec), ['libaom-av1', 'libx264']);
  assert.equal(mounted[1].name, 'decoded.mkv');
  assert.ok(loaded[1].commands[0].includes('preview.mp4'));
});
test('cancelling AV1 preparation never starts the output encoder', async () => {
  const { engine, loaded } = runner(), load = engine.load;
  engine.load = async codec => {
    const core = await load(codec);
    core.exec = async () => { engine.cancel(); return 0; };
    return core;
  };
  await assert.rejects(engine.compress(file, job), /Cancelled/);
  assert.equal(loaded.length, 1); assert.equal(loaded[0].terminated, true);
});
test('failed AV1 preparation terminates the worker and never exposes partial output', async () => {
  const { engine, loaded } = runner(), load = engine.load;
  engine.load = async codec => { const core = await load(codec); core.exec = async () => 1; return core; };
  await assert.rejects(engine.compress(file, job), /Could not decode the AV1 source/);
  assert.equal(loaded.length, 1); assert.equal(loaded[0].terminated, true);
});
