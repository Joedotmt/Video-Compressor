import test from 'node:test';
import assert from 'node:assert/strict';
import { expression, metadata, plan, command, tempo, preparedJob } from '../../web/compressor.js';
const source = { duration: 60, audio: true };
const values = { target: '10', width: '1920/2', height: '1081/2', fps: '30', speed: '1', audioKbps: '128', audio: true, codec: 'libx264', preset: 'medium', tune: '' };
test('safe arithmetic with precedence, unary signs and parentheses', () => {
  assert.equal(expression(' (1920 / 2) - 10 * -2 '), 980);
  for (const s of ['1/0', 'alert(1)', '2**3', '1;2', '()', '1e3', '1.2.3', '2(3)']) assert.throws(() => expression(s));
});
test('bitrate budget matches desktop and speed changes output duration', () => {
  const job = plan(values, source);
  assert.equal(job.videoBps, Math.floor((10 * 1048576 * 8 / 60 - 128000) * .97));
  assert.equal(job.width, 960); assert.equal(job.height, 540);
  assert.equal(plan({ ...values, speed: '2' }, source).duration, 30);
  assert.throws(() => plan({ ...values, target: '.01' }, source), /too small/);
  assert.throws(() => plan({ ...values, fps: '1001' }, source));
});
test('muted/no-audio input reserves no audio budget', () => {
  const job = plan({ ...values, audioKbps: 'invalid' }, { ...source, audio: false });
  assert.equal(job.audioBps, 0); assert.ok(command(job, 'input').includes('-an'));
});
test('speed filters stay in supported range and output fps follows retiming', () => {
  assert.equal(tempo(.125), 'atempo=0.5,atempo=0.5,atempo=0.5');
  assert.equal(tempo(10000), 'atempo=100,atempo=100');
  const args = command(plan({ ...values, speed: '2' }, source), '/input/a video.mp4');
  assert.ok(args.includes('/input/a video.mp4'));
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=960:540,setsar=1,setpts=(PTS-STARTPTS)/2,fps=30');
});
test('codec-specific options and tuning', () => {
  const av1 = command(plan({ ...values, codec: 'libaom-av1', preset: '6' }, source), 'input');
  assert.ok(av1.includes('-cpu-used')); assert.ok(!av1.includes('-preset'));
  assert.throws(() => plan({ ...values, codec: 'libx265', tune: 'film' }, source));
});
test('probe finds video and handles missing audio bitrate/fps', () => {
  const info = metadata({ format: { duration: '4.5' }, streams: [{ codec_type: 'video', width: 320, height: 240, avg_frame_rate: '0/0', r_frame_rate: '30000/1001' }, { codec_type: 'audio' }] }, 1048576);
  assert.equal(info.sizeMB, 1); assert.equal(info.audioKbps, 128); assert.equal(info.fps, 30000 / 1001);
  assert.throws(() => metadata({ streams: [] }, 10));
});
test('AV1 source codec survives probing and planning; software decoder is an input option', () => {
  const info = metadata({ format: { duration: '2' }, streams: [{ codec_type: 'video', codec_name: 'av1', width: 128, height: 96, avg_frame_rate: '12/1' }] }, 10000);
  assert.equal(info.videoCodec, 'av1');
  const job = plan({ ...values, width: '64', height: '48', fps: '12' }, info);
  const args = command(job, 'source.webm');
  assert.equal(job.inputCodec, 'av1');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libaom-av1');
  assert.ok(args.indexOf('-c:v') < args.indexOf('-i'));
  assert.equal(args[args.lastIndexOf('-c:v') + 1], 'libx264');
});
test('AV1 bridge applies edits once and keeps final encoder settings and bitrate', () => {
  const job = plan({ ...values, speed: '2' }, { ...source, width: 1920, height: 1080, videoCodec: 'av1' }, { segments: [{ start: 1, end: 5 }], crop: { x: 11, y: 13, width: 100, height: 80 } });
  const bridge = command(job, 'source.webm', 'decoded.mkv', { intermediate: true });
  assert.equal(bridge[bridge.lastIndexOf('-c:v') + 1], 'ffv1');
  assert.equal(bridge[bridge.indexOf('-c:a') + 1], 'pcm_f32le');
  assert.match(bridge[bridge.indexOf('-filter_complex') + 1], /trim=start=1:end=5/);
  assert.ok(!bridge.includes('-b:v'));
  const prepared = preparedJob(job), final = command(prepared, 'decoded.mkv');
  assert.equal(prepared.speed, 1); assert.equal(prepared.crop, undefined); assert.equal(prepared.segments, undefined);
  assert.equal(prepared.videoBps, job.videoBps); assert.equal(prepared.audioBps, job.audioBps);
  assert.equal(prepared.duration, 2); assert.equal(prepared.codec, job.codec);
  assert.ok(!final.includes('libaom-av1')); assert.ok(!final.includes('-filter_complex'));
  assert.equal(final[final.indexOf('-vf') + 1], 'scale=960:540,setsar=1,setpts=(PTS-STARTPTS)/1,fps=30');
});
