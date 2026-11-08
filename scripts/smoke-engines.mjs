// Execute the exact shipped WebAssembly, without a native encoding substitute.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import Worker from 'web-worker';
import { pathToFileURL } from 'node:url';
globalThis.Worker = class extends Worker { constructor(url) { super(new URL('data:text/javascript,' + encodeURIComponent(`self.location = {href: ${JSON.stringify(String(url))}}; await import(${JSON.stringify(String(url))});`)), { type: 'module' }); } };
import { command, plan, metadata } from '../web/compressor.js';
globalThis.self = { location: { href: 'file:///ffmpeg-core.js' } };
const { default: standard } = await import('../public/engine/ffmpeg-core.js');
const { default: threaded } = await import('../public/engine-mt/ffmpeg-core.js');
const { default: av1 } = await import('../public/av1/ffmpeg-core.js');
const directory = await mkdtemp(join(tmpdir(), 'joemt-smoke-'));
try {
  const input = join(directory, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x96:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
  const bytes = new Uint8Array(await readFile(input));
  for (const codec of ['libx264', 'libx265', 'libaom-av1']) {
    const path = codec === 'libaom-av1' ? 'public/av1' : codec === 'libx265' ? 'public/engine-mt' : 'public/engine';
    const f = await (codec === 'libaom-av1' ? av1 : codec === 'libx265' ? threaded : standard)({ wasmBinary: await readFile(`${path}/ffmpeg-core.wasm`), mainScriptUrlOrBlob: pathToFileURL(`${process.cwd()}/${path}/ffmpeg-core.js`).href + '#' + btoa(JSON.stringify({ wasmURL: pathToFileURL(`${process.cwd()}/${path}/ffmpeg-core.wasm`).href, workerURL: pathToFileURL(`${process.cwd()}/${path}/ffmpeg-core.worker.js`).href })), locateFile: name => pathToFileURL(`${process.cwd()}/${path}/${name}`).href });
    const logs = []; f.setLogger(({ message }) => { logs.push(message); if (process.env.ENCODER_DEBUG) console.log(message); });
    f.FS.writeFile('/input.mp4', bytes);
    f.ffprobe('-v', 'error', '-show_format', '-show_streams', '-of', 'json', '/input.mp4', '-o', '/probe.json');
    assert.equal(f.ret, 0, logs.join('\n')); f.reset();
    const info = metadata(JSON.parse(f.FS.readFile('/probe.json', { encoding: 'utf8' })), bytes.length);
    assert.equal(info.width, 128); assert.equal(info.audio, true);
    const job = plan({ target: '.05', width: '96', height: '64', fps: '10', speed: '2', audioKbps: '64', audio: codec !== 'libx265', codec, preset: codec === 'libaom-av1' ? '6' : 'ultrafast', tune: '' }, info);
    f.exec(...command(job, '/input.mp4'));
    assert.equal(f.ret, 0, `${codec}: ${logs.slice(-25).join('\n')}`);
    const out = join(directory, `${codec}.mp4`);
    await writeFile(out, f.FS.readFile('output.mp4'));
    const result = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }));
    const video = result.streams.find(s => s.codec_type === 'video');
    assert.equal(video.codec_name, { libx264: 'h264', libx265: 'hevc', 'libaom-av1': 'av1' }[codec]);
    assert.equal(video.width, 96); assert.equal(video.height, 64); assert.equal(video.avg_frame_rate, '10/1');
    assert.equal(video.sample_aspect_ratio, '1:1', `${codec}: square output pixels`);
    assert.equal(video.display_aspect_ratio, '3:2', `${codec}: dimensions must stretch the original 4:3 image`);
    assert.ok(Math.abs(Number(result.format.duration) - 1) < .25);
    assert.equal(result.streams.some(s => s.codec_type === 'audio'), job.audio);
    f.reset();
    const editJob = plan({ target: '.05', width: '96', height: '64', fps: '12', speed: '2', audioKbps: '64', audio: codec !== 'libx265', codec, preset: codec === 'libaom-av1' ? '6' : 'ultrafast', tune: '' }, info, {
      segments: [{ start: .25, end: .75 }, { start: 1.25, end: 1.75 }],
      crop: { x: 11, y: 13, width: 96, height: 80 },
    });
    f.exec(...command(editJob, '/input.mp4', 'edited.mp4'));
    assert.equal(f.ret, 0, `${codec} edits: ${logs.slice(-30).join('\n')}`);
    const editedPath = join(directory, `${codec}-edited.mp4`);
    await writeFile(editedPath, f.FS.readFile('edited.mp4'));
    const editedInfo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', editedPath], { encoding: 'utf8' }));
    assert.ok(Math.abs(Number(editedInfo.format.duration) - .5) < .15, 'trim and speed duration');
    assert.equal(editedInfo.streams.some(s => s.codec_type === 'audio'), editJob.audio);
    const editedVideo = editedInfo.streams.find(s => s.codec_type === 'video');
    assert.equal(editedVideo.sample_aspect_ratio, '1:1', `${codec}: square pixels after trim and crop`);
    assert.equal(editedVideo.display_aspect_ratio, '3:2', `${codec}: cropped image stretches to requested dimensions`);
    const decoded = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', editedPath, '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    // Independent native reference: select frames rather than trim/concat.
    const expected = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-an', '-vf', "select='between(t,0.25,0.74999)+between(t,1.25,1.74999)',setpts=N/(24*TB),crop=96:80:11:13:exact=1,scale=96:64,setsar=1,fps=12", '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    assert.equal(decoded.length, expected.length, `${codec}: output frame count`);
    const error = decoded.reduce((total, byte, i) => total + Math.abs(byte - expected[i]), 0) / decoded.length;
    assert.ok(error < 12, `${codec}: cropped/trimmed image difference ${error}`);
    console.log(`${codec}: two joined segments, exact crop position, 2× speed and decoded frame content verified (mean RGB error ${error.toFixed(2)})`);
    f.PThread?.terminateAllThreads();
    console.log(`${codec}: encoded and verified dimensions, frame rate, 2× speed, audio and MP4 output (${result.format.size} bytes)`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
