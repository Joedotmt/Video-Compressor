import test from 'node:test';
import assert from 'node:assert/strict';
import { expression, metadata, plan, command, tempo } from '../../web/compressor.js';
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
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=960:540,setpts=(PTS-STARTPTS)/2,fps=30');
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
