// Toolkit-independent planning; the same bitrate model as compressor.py.
export const presets = [['Very fast', 'ultrafast'], ['Fast', 'fast'], ['Balanced', 'medium'], ['Slow', 'slow']];
export const av1Presets = [['Highest quality', '0'], ['Very high quality', '1'], ['High quality', '2'], ['Quality', '3'], ['Balanced', '4'], ['Fast', '5'], ['Fastest', '6']];
export const tunes = { libx264: ['', 'film', 'animation', 'grain', 'stillimage'], libx265: ['', 'animation', 'grain'], 'libaom-av1': [''] };
export function expression(text) {
  // Recursive descent rather than eval: arithmetic only, with bounded input.
  const input = String(text).replace(/\s/g, '');
  if (!input || input.length > 256 || /[^\d.+*/()\-]/.test(input)) throw new Error('Enter a number or arithmetic expression.');
  let i = 0;
  const atom = () => {
    if (input[i] === '+') { i++; return atom(); }
    if (input[i] === '-') { i++; return -atom(); }
    if (input[i] === '(') { i++; const n = sum(); if (input[i++] !== ')') throw new Error('Close the parentheses.'); return n; }
    const match = input.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error('Enter a valid arithmetic expression.');
    i += match[0].length; return Number(match[0]);
  };
  const product = () => { let n = atom(); while (input[i] === '*' || input[i] === '/') { const op = input[i++], rhs = atom(); n = op === '*' ? n * rhs : n / rhs; } return n; };
  const sum = () => { let n = product(); while (input[i] === '+' || input[i] === '-') { const op = input[i++], rhs = product(); n = op === '+' ? n + rhs : n - rhs; } return n; };
  const result = sum();
  if (i !== input.length || !Number.isFinite(result)) throw new Error('Enter a finite, valid number.');
  return result;
}
export function metadata(data, size) {
  const video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = data.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(data.format?.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !(video.width > 0) || !(video.height > 0)) throw new Error('This file has no readable video or duration.');
  let fps;
  try { fps = expression(video.avg_frame_rate); } catch { try { fps = expression(video.r_frame_rate); } catch { fps = 30; } }
  if (!(fps > 0)) fps = 30;
  return { width: video.width, height: video.height, duration, fps, sizeMB: size / 1048576, audio: !!audio, audioKbps: audio ? Math.round(Number(audio.bit_rate) / 1000) || 128 : 0 };
}
export function plan(values, source) {
  const ranges = { target: [0.01, 1000000], width: [2, 16384], height: [2, 16384], fps: [0.01, 1000], speed: [0.01, 10000], audioKbps: [1, 10000] };
  const job = { codec: values.codec, preset: values.preset, tune: values.tune, audio: values.audio && source.audio };
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (field === 'audioKbps' && !job.audio) { job[field] = 0; continue; }
    try { job[field] = expression(values[field]); if (job[field] < min || job[field] > max) throw new Error(`Use a value between ${min} and ${max}.`); }
    catch (error) { error.field = field; throw error; }
  }
  job.width = Math.floor(job.width / 2) * 2; job.height = Math.floor(job.height / 2) * 2;
  if (!Object.hasOwn(tunes, job.codec)) throw new Error('Choose a supported codec.');
  if (!(job.codec === 'libaom-av1' ? av1Presets : presets).some(p => p[1] === job.preset)) throw new Error('Choose a valid encoding preset.');
  if (!tunes[job.codec].includes(job.tune)) throw new Error('Choose a valid tuning option.');
  job.duration = source.duration / job.speed;
  job.audioBps = Math.round(job.audioKbps * 1000);
  job.videoBps = Math.floor((job.target * 1048576 * 8 / job.duration - job.audioBps) * 0.97);
  if (job.videoBps < 1 || !Number.isFinite(job.videoBps)) { const error = new Error('Target size is too small for the audio. Increase it or remove audio.'); error.field = 'target'; throw error; }
  return job;
}
export function tempo(speed) {
  const factors = [];
  while (speed < 0.5) { factors.push(0.5); speed /= 0.5; }
  while (speed > 100) { factors.push(100); speed /= 100; }
  if (Math.abs(speed - 1) > 1e-9) factors.push(speed);
  return factors.map(n => `atempo=${n}`).join(',');
}
export function command(job, input, output = 'output.mp4') {
  const args = ['-y', '-threads', '1', '-filter_threads', '1', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', job.codec];
  args.push(...(job.codec === 'libaom-av1' ? ['-cpu-used', job.preset] : ['-preset', job.preset]));
  if (job.tune && job.codec !== 'libaom-av1') args.push('-tune', job.tune);
  if (job.codec === 'libx265') args.push('-tag:v', 'hvc1', '-x265-params', 'pools=none:frame-threads=1');
  args.push('-threads', '1', '-b:v', String(job.videoBps), '-pix_fmt', 'yuv420p');
  if (!job.audio) args.push('-an');
  else { args.push('-c:a', 'aac', '-b:a', String(job.audioBps)); if (tempo(job.speed)) args.push('-af', tempo(job.speed)); }
  // Retiming before fps keeps the requested output frame rate at altered speeds.
  args.push('-vf', `scale=${job.width}:${job.height},setpts=(PTS-STARTPTS)/${job.speed},fps=${job.fps}`, '-movflags', '+faststart', output);
  return args;
}
export const durationLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
