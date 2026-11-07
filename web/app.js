import { plan, presets, av1Presets, tunes, durationLabel } from './compressor.js';
import { BrowserCompressor } from './engine.js';
import { initializeIsolation } from './isolation.js';
const $ = id => document.getElementById(id);
const fields = ['target', 'width', 'height', 'fps', 'speed', 'audioKbps', 'codec', 'preset', 'tune'];
let initializing = true;
let file = null, source = null, job = null, busy = false, runner = null, outputURL = null, logs = [], started = 0;
const number = n => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const message = (text = '', error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
function log(line) { logs.push(line); if (logs.length > 200) logs.shift(); $('logs').textContent = logs.join('\n'); $('diagnostics').hidden = false; }
function encoderOptions() {
  const av1 = $('codec').value === 'libaom-av1';
  $('preset').replaceChildren(...(av1 ? av1Presets : presets).map(([label, value]) => new Option(label, value)));
  $('preset').value = av1 ? '4' : 'medium';
  $('tune').replaceChildren(...tunes[$('codec').value].map(value => new Option(value ? value[0].toUpperCase() + value.slice(1) : 'None', value)));
  $('tune').disabled = av1;
  $('codec-hint').textContent = av1 ? 'AV1 encoding can be slow.' : $('codec').value === 'libx265' ? 'HEVC requires browser isolation and about 1 GB of free memory.' : '';
}
function validate() {
  job = null;
  fields.forEach(id => $(id).removeAttribute('aria-invalid'));
  $('validation').textContent = '';
  $('audio').disabled = !source?.audio;
  $('audioKbps').disabled = !$('audio').checked || !source?.audio;
  if (source) {
    try {
      job = plan({ ...Object.fromEntries(fields.map(id => [id, $(id).value])), audio: $('audio').checked }, source);
      if (!$('output-name').value.trim() || /[/\\\x00-\x1f]/.test($('output-name').value)) { job = null; throw new Error('Enter a filename without slashes or control characters.'); }
      $('bitrate').textContent = `${number(job.videoBps / 1000)} kbps`;
      $('output-summary').textContent = `${job.width} × ${job.height} · ${number(job.fps)} fps · ${durationLabel(job.duration)} output`;
    } catch (error) { $('validation').textContent = error.message; if (error.field) $(error.field).setAttribute('aria-invalid', 'true'); $('bitrate').textContent = '—'; }
  }
  $('compress').disabled = busy || !job;
}
function setBusy(value) {
  busy = value; $('controls').disabled = value || !source;
  $('dropzone').disabled = value; $('replace').disabled = value;
  $('activity').hidden = !value; $('cancel').disabled = false;
  $('cancel').hidden = !value;
  $('compress').hidden = !source;
  $('editor').hidden = !source;
  $('empty-state').hidden = !!source || value;
  validate();
}
function clearOutput() { if (outputURL) URL.revokeObjectURL(outputURL); outputURL = null; $('result').hidden = true; $('download').removeAttribute('href'); }
function activity(title, text) { $('activity-title').textContent = title; $('status').textContent = text; $('progress').removeAttribute('value'); }
function newRunner(duration) {
  logs = []; $('logs').textContent = '';
  return new BrowserCompressor(log, seconds => {
    if (!duration || !busy) return;
    const percent = Math.min(99, Math.max(0, seconds / duration * 100));
    $('progress').value = percent;
    $('activity-title').textContent = `Compressing · ${Math.floor(percent)}%`;
    $('status').textContent = `${durationLabel((Date.now() - started) / 1000)} elapsed · Keep this tab open.`;
  });
}
async function openFile(selected) {
  if (!selected || busy || initializing) return;
  if (!selected.size) { message('This file is empty. Choose a video file.', true); return; }
  // Memory32 FFmpeg cannot address files of 2 GiB or more.
  if (selected.size >= 2 * 1024 ** 3) { message('This video exceeds the browser engine’s 2 GB file limit. Use a smaller source video.', true); return; }
  clearOutput(); message(); source = null; file = null;
  setBusy(true); activity('Reading video…', 'Loading the local video engine. The first download is about 32 MB.');
  const task = newRunner(); runner = task;
  try {
    const info = await task.probe(selected);
    if (task.cancelled) return;
    source = info; file = selected;
    $('filename').textContent = file.name;
    $('source-summary').textContent = `${source.width} × ${source.height} · ${number(source.fps)} fps · ${durationLabel(source.duration)} · ${number(source.sizeMB)} MB`;
    $('target').value = Math.max(.01, source.sizeMB).toFixed(2);
    resetVideo(); resetAudio(); $('speed').value = '1';
    $('output-name').value = `${file.name.replace(/\.[^.]+$/, '')}_compressed.mp4`;
    $('audio-hint').textContent = source.audio ? 'Include audio in the compressed video' : 'This video has no audio track.';
  } catch (error) { if (!task.cancelled) message(error.message || 'Could not read the video.', true); }
  finally { runner = null; setBusy(false); }
}
function resetVideo() { if (!source) return; for (const key of ['width', 'height', 'fps']) $(key).value = String(source[key]); }
function resetAudio() { if (!source) return; $('audio').checked = source.audio; $('audioKbps').value = source.audioKbps || 128; }
$('file').addEventListener('change', event => { openFile(event.target.files[0]); event.target.value = ''; });
for (const id of ['dropzone', 'replace']) $(id).addEventListener('click', () => { if (!busy && !initializing) $('file').click(); });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); if (!busy && !initializing) $('file').click(); } });
document.addEventListener('dragover', event => { event.preventDefault(); if (!busy) document.querySelector('main').classList.add('dragover'); });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.querySelector('main').classList.remove('dragover'); });
document.addEventListener('drop', event => { event.preventDefault(); document.querySelector('main').classList.remove('dragover'); if (!busy) openFile(event.dataTransfer.files[0]); });
$('codec').addEventListener('change', () => { encoderOptions(); validate(); });
$('settings').addEventListener('input', validate);
$('reset-target').addEventListener('click', () => { $('target').value = Math.max(.01, source.sizeMB).toFixed(2); validate(); });
$('reset-video').addEventListener('click', () => { resetVideo(); validate(); });
$('reset-audio').addEventListener('click', () => { resetAudio(); validate(); });
$('cancel').addEventListener('click', () => { runner?.cancel(); $('cancel').disabled = true; message('Cancelled. No partial output was saved.'); });
$('settings').addEventListener('submit', async event => {
  event.preventDefault(); validate(); if (!job || busy) return;
  const currentJob = { ...job };
  const outputName = $('output-name').value.trim().replace(/(?:\.mp4)?$/i, '.mp4');
  clearOutput(); message(); setBusy(true); started = Date.now();
  activity('Preparing compression…', 'Loading the encoder. Processing stays on this device.');
  const task = newRunner(currentJob.duration); runner = task;
  try {
    const blob = await task.compress(file, currentJob);
    if (task.cancelled) return;
    outputURL = URL.createObjectURL(blob);
    $('download').href = outputURL; $('download').download = outputName;
    const saved = (1 - blob.size / file.size) * 100;
    $('result-summary').textContent = `${number(blob.size / 1048576)} MB · ${saved >= 0 ? `${number(saved)}% smaller` : `${number(-saved)}% larger`} · ${durationLabel((Date.now() - started) / 1000)} processing time. Target sizes are approximate.`;
    $('result').hidden = false; $('download').focus();
  } catch (error) { if (!task.cancelled) message(error.message || 'The browser ran out of resources. Try a smaller video or resolution.', true); }
  finally { runner = null; setBusy(false); }
});
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
encoderOptions(); validate();

$('dropzone').disabled = true;
initializeIsolation().finally(() => { initializing = false; $('dropzone').disabled = false; });
