// Regression for AV1 WebM input: stock cores cannot decode it in WASM.
// Exercise the shipped software decoder and lossless handoff to H.264/HEVC.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import Worker from 'web-worker';
import { metadata, plan, command, preparedJob } from '../web/compressor.js';
import standard from '../public/engine/ffmpeg-core.js';
import threaded from '../public/engine-mt/ffmpeg-core.js';
import av1 from '../public/av1/ffmpeg-core.js';
globalThis.Worker = class extends Worker {
  constructor(url) {
    super(new URL('data:text/javascript,' + encodeURIComponent(`self.location = {href: ${JSON.stringify(String(url))}}; await import(${JSON.stringify(String(url))});`)), { type: 'module' });
  }
};
globalThis.self = { location: { href: 'file:///ffmpeg-core.js' } };
const directory = await mkdtemp(join(tmpdir(), 'joemt-av1-input-'));
const cores = [];
async function load(factory, folder) {
  const base = pathToFileURL(`${process.cwd()}/public/${folder}/`);
  const f = await factory({
    wasmBinary: await readFile(new URL('ffmpeg-core.wasm', base)),
    mainScriptUrlOrBlob: new URL('ffmpeg-core.js', base).href + '#' + btoa(JSON.stringify({ wasmURL: new URL('ffmpeg-core.wasm', base).href, workerURL: new URL('ffmpeg-core.worker.js', base).href })),
    locateFile: name => new URL(name, base).href
  });
  const logs = []; f.setLogger(({ message }) => { logs.push(message); if (logs.length > 100) logs.shift(); });
  f.logs = logs; cores.push(f); return f;
}
function exec(f, args) { f.exec(...args); assert.equal(f.ret, 0, f.logs.join('\n')); f.reset(); }
try {
  const input = join(directory, 'source.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x96:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '30', '-c:a', 'libopus', input]);
  const bytes = new Uint8Array(await readFile(input));
  const stock = await load(standard, 'engine');
  stock.FS.writeFile('/source.webm', bytes);
  exec(stock, ['-v', 'error', '-i', '/source.webm', '-c:v', 'copy', '-c:a', 'copy', '/copy.webm']);
  stock.exec('-v', 'error', '-i', '/source.webm', '-f', 'null', '-');
  assert.notEqual(stock.ret, 0, 'The regression fixture must reproduce the missing AV1 decoder');
  assert.match(stock.logs.join('\n'), /hardware accelerated AV1 decoding|Missing Sequence Header/);
  stock.reset();
  stock.ffprobe('-v', 'error', '-show_format', '-show_streams', '-of', 'json', '/source.webm', '-o', '/probe.json');
  assert.equal(stock.ret, 0); stock.reset();
  const source = metadata(JSON.parse(stock.FS.readFile('/probe.json', { encoding: 'utf8' })), bytes.length);
  assert.equal(source.videoCodec, 'av1');
  const values = { target: '.05', width: '64', height: '48', fps: '12', speed: '2', audioKbps: '64', audio: true, codec: 'libx264', preset: 'ultrafast', tune: '' };
  const edits = { segments: [{ start: .25, end: .75 }, { start: 1.25, end: 1.75 }], crop: { x: 11, y: 13, width: 96, height: 64 } };
  const job = plan(values, source, edits);
  const decoder = await load(av1, 'av1'); decoder.FS.writeFile('/source.webm', bytes);
  exec(decoder, command(job, '/source.webm', 'decoded.mkv', { intermediate: true }));
  const intermediate = decoder.FS.readFile('decoded.mkv');
  const reference = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-an', '-vf', "select='between(t,0.25,0.74999)+between(t,1.25,1.74999)',setpts=N/(24*TB),crop=96:64:11:13:exact=1,scale=64:48,fps=12", '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  for (const codec of ['libx264', 'libx265', 'libaom-av1']) {
    const direct = codec === 'libaom-av1';
    const f = direct ? decoder : codec === 'libx265' ? await load(threaded, 'engine-mt') : stock;
    if (!direct) f.FS.writeFile('/decoded.mkv', intermediate);
    const selected = { ...job, codec, preset: direct ? '6' : 'ultrafast' };
    exec(f, command(direct ? selected : preparedJob(selected), direct ? '/source.webm' : '/decoded.mkv'));
    const output = join(directory, `${codec}.mp4`); await writeFile(output, f.FS.readFile('output.mp4'));
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
    const video = info.streams.find(s => s.codec_type === 'video');
    assert.equal(video.codec_name, { libx264: 'h264', libx265: 'hevc', 'libaom-av1': 'av1' }[codec]);
    assert.equal(video.width, 64); assert.equal(video.height, 48); assert.equal(video.avg_frame_rate, '12/1');
    assert.equal(video.sample_aspect_ratio, '1:1', `${codec}: square pixels through the AV1 path`);
    assert.equal(video.display_aspect_ratio, '4:3', `${codec}: crop stretches to the requested output shape`);
    assert.ok(info.streams.some(s => s.codec_type === 'audio'));
    assert.ok(Math.abs(Number(info.format.duration) - .5) < .15);
    const actual = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', output, '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    assert.equal(actual.length, reference.length, `${codec} frame count`);
    const difference = actual.reduce((sum, byte, i) => sum + Math.abs(byte - reference[i]), 0) / actual.length;
    assert.ok(difference < 12, `${codec}: decoded image difference ${difference}`);
    f.PThread?.terminateAllThreads();
    console.log(`AV1 WebM → ${codec}: software decode, two trims, crop, resize, 2× speed, audio, and decoded frame content verified (${difference.toFixed(2)} mean RGB error).`);
  }
} finally {
  for (const f of cores) f.PThread?.terminateAllThreads();
  await rm(directory, { recursive: true, force: true });
}
