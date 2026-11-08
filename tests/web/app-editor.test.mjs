import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

test('tabs, edit validation, automatic dimensions and export share the same job', async () => {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { url: 'http://localhost/' });
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.Option = dom.window.Option;
  for (const method of ['pause', 'load']) dom.window.HTMLMediaElement.prototype[method] = () => {};
  let submitted, finish, failProbe = false;
  globalThis.__testEncoder = class {
    constructor(log) { this.log = log; }
    async probe() { this.log('Inspecting source'); if (failProbe) throw new Error('Cannot read source'); return { width: 640, height: 480, duration: 8, fps: 25, audio: true, audioKbps: 128, sizeMB: 4 }; }
    compress(_file, job) { submitted = job; return new Promise(resolve => { finish = resolve; }); }
  };
  // Keep application/state code real; substitute only external engine and SW startup.
  let app = readFileSync('web/app.js', 'utf8');
  app = app.replace("import { BrowserCompressor } from './engine.js';", 'const BrowserCompressor = globalThis.__testEncoder;');
  app = app.replace("import { initializeIsolation } from './isolation.js';", 'const initializeIsolation = async () => {};');
  for (const file of ['compressor.js', 'editor.js']) app = app.replace(`'./${file}'`, JSON.stringify(pathToFileURL(resolve('web', file)).href));
  await import(`data:text/javascript;base64,${Buffer.from(app).toString('base64')}`);
  const $ = id => document.getElementById(id);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const input = (id, value, event = 'input') => { $(id).value = value; $(id).dispatchEvent(new dom.window.Event(event, { bubbles: true })); };
  await tick();
  Object.defineProperty($('file'), 'files', { value: [new File(['fixture'], 'source.mp4')], configurable: true });
  $('file').dispatchEvent(new dom.window.Event('change')); await tick();
  assert.equal($('editor').hidden, false); assert.equal($('edit-tab').disabled, false);
  $('edit-tab').click(); assert.equal($('compression-panel').hidden, true);
  assert.equal($('edit-tab').getAttribute('aria-selected'), 'true');
  assert.ok($('diagnostics').closest('.timeline-options'));
  assert.equal($('diagnostics').closest('.bottom-bar'), null);
  input('crop-width', '640/2'); input('crop-x', '11'); assert.equal($('width').value, '320');
  $('compression-tab').click(); input('width', '160'); input('speed', '2');
  $('edit-tab').click(); input('crop-width', '200'); assert.equal($('width').value, '160');
  for (const [start, end] of [[1, 3], [5, 7]]) {
    input('playhead-time', String(start), 'change'); $('mark-in').click();
    input('playhead-time', String(end), 'change'); $('mark-out').click();
  }
  $('mark-in').click(); assert.equal($('compress').disabled, false);
  assert.equal($('cancel-draft'), null);
  assert.equal($('compress').textContent.trim(), 'Export');
  assert.ok($('compress').closest('.app-header')); assert.ok($('replace').closest('.app-header'));
  assert.ok($('edit-tab').closest('.app-header'));
  assert.equal($('output-name'), null);
  input('preview-volume', '0');
  $('compress').click();
  assert.equal($('edit-controls').disabled, true);
  assert.equal(submitted.duration, 2.5);
  assert.equal(submitted.audio, true); // Preview volume never changes exported audio.
  assert.deepEqual(submitted.segments, [{ start: 1, end: 3 }, { start: 5, end: 8 }]);
  assert.deepEqual(submitted.crop, { x: 11, y: 0, width: 200, height: 480 });
  assert.equal(submitted.width, 160);
  finish(new Blob(['encoded'], { type: 'video/mp4' })); await tick();
  assert.equal($('result').hidden, false); assert.equal($('edit-controls').disabled, false);
  assert.equal($('download').download, 'source_compressed.mp4');
  const replace = async name => {
    Object.defineProperty($('file'), 'files', { value: [new File(['fixture'], name)], configurable: true });
    $('file').dispatchEvent(new dom.window.Event('change')); await tick();
  };
  await replace('replacement.mp4');
  assert.equal($('edit-tab').getAttribute('aria-selected'), 'true');
  assert.equal($('edit-panel').hidden, false); assert.equal($('compression-panel').hidden, true);
  assert.equal($('filename').textContent, 'replacement.mp4');
  assert.ok($('diagnostics').closest('.timeline-options'));
  failProbe = true; await replace('broken.mp4');
  assert.equal($('edit-tab').getAttribute('aria-selected'), 'true');
  assert.equal($('diagnostics').parentElement, $('header-options'));
  assert.match($('message').textContent, /Cannot read source/);
  failProbe = false; await replace('retry.mp4');
  assert.equal($('edit-panel').hidden, false);
  $('compression-tab').click();
  assert.equal($('diagnostics').parentElement, $('compression-options'));
  await replace('compression.mp4');
  assert.equal($('compression-tab').getAttribute('aria-selected'), 'true');
  assert.equal($('compression-panel').hidden, false);
  assert.equal($('diagnostics').parentElement, $('compression-options'));
  dom.window.close(); delete globalThis.__testEncoder;
});
